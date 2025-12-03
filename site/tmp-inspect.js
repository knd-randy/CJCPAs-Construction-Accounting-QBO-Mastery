const { prebuiltAppConfig } = require('@mlc-ai/web-llm')
console.log(prebuiltAppConfig.model_list.map((m) => m.model_id))
