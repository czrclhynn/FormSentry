const assets=['assets/logo.svg','assets/favicon.svg',... [16,32,48,128].map(n=>`assets/icon-${n}.png`)];
const dashboard=['options.html','options.js','teacher-client.js','cloud-config.js','cloud-client.js','shared.js','ui.js','ui.css','setup.html','setup.js',...assets];
module.exports={dashboard,extension:[...dashboard,'manifest.json','background.js','event-processor.js','cloud-sync.js','content.js','popup.html','popup.js','blocked.html','blocked.js']};
