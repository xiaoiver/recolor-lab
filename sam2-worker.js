import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/ort.all.min.mjs';

const MODEL_URLS={
  encoder:'https://huggingface.co/g-ronimo/sam2-tiny/resolve/main/sam2_hiera_tiny_encoder.with_runtime_opt.ort',
  decoder:'https://huggingface.co/g-ronimo/sam2-tiny/resolve/main/sam2_hiera_tiny_decoder.onnx',
};

ort.env.wasm.wasmPaths='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/';

let encoderSession,decoderSession,features;

async function fetchModel(url,stage){
  postMessage({type:'progress',stage});
  const response=await fetch(url,{cache:'force-cache'});
  if(!response.ok)throw Error(`模型下载失败（${response.status}）`);
  return response.arrayBuffer();
}

async function createSession(model){
  let lastError;
  for(const ep of ['webgpu','wasm']){
    try{return {session:await ort.InferenceSession.create(model,{executionProviders:[ep]}),ep};}
    catch(error){lastError=error;}
  }
  throw lastError||Error('无法初始化 ONNX Runtime');
}

async function load(){
  if(encoderSession&&decoderSession)return {device:encoderSession.ep};
  const [encoder,decoder]=await Promise.all([
    fetchModel(MODEL_URLS.encoder,'正在下载编码器（约 135 MB）…'),
    fetchModel(MODEL_URLS.decoder,'正在下载解码器（约 17 MB）…'),
  ]);
  postMessage({type:'progress',stage:'正在创建 WebGPU 会话…'});
  [encoderSession,decoderSession]=await Promise.all([createSession(encoder),createSession(decoder)]);
  return {device:encoderSession.ep};
}

function output(results,session,names){
  for(const name of names)if(results[name])return results[name];
  for(const name of session.outputNames)if(results[name])return results[name];
  throw Error('模型未返回预期输出');
}

async function encode({pixels,shape}){
  if(!encoderSession)throw Error('请先加载模型');
  postMessage({type:'progress',stage:'正在编码首帧…'});
  const result=await encoderSession.session.run({image:new ort.Tensor('float32',pixels,shape)});
  const names=encoderSession.session.outputNames;
  features={
    high_res_feats_0:result.high_res_feats_0||result[names[0]],
    high_res_feats_1:result.high_res_feats_1||result[names[1]],
    image_embed:result.image_embed||result[names[2]],
  };
}

async function decode({x,y},id){
  if(!features||!decoderSession)throw Error('请先编码首帧');
  const inputs={
    image_embed:features.image_embed,
    high_res_feats_0:features.high_res_feats_0,
    high_res_feats_1:features.high_res_feats_1,
    point_coords:new ort.Tensor('float32',[x,y],[1,1,2]),
    point_labels:new ort.Tensor('float32',[1],[1,1]),
    mask_input:new ort.Tensor('float32',new Float32Array(256*256),[1,1,256,256]),
    has_mask_input:new ort.Tensor('float32',[0],[1]),
    orig_im_size:new ort.Tensor('int32',[1024,1024],[2]),
  };
  postMessage({type:'progress',stage:'正在从点击生成候选…'});
  const result=await decoderSession.session.run(inputs);
  const masks=output(result,decoderSession.session,['masks','low_res_masks']);
  const scores=output(result,decoderSession.session,['iou_predictions','iou_scores']);
  const maskData=new Float32Array(masks.data);
  const scoreData=new Float32Array(scores.data);
  postMessage({id,type:'decoded',masks:maskData,maskDims:masks.dims,scores:scoreData},[maskData.buffer,scoreData.buffer]);
}

self.onmessage=async({data})=>{
  const {id,type,payload}=data;
  try{
    if(type==='load')postMessage({id,type:'loaded',...(await load())});
    if(type==='encode'){await encode(payload);postMessage({id,type:'encoded'});}
    if(type==='decode')await decode(payload,id);
  }catch(error){postMessage({id,type:'error',error:error instanceof Error?error.message:String(error)});}
};
