const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),files=require('./files.cjs').extension;
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const manifest=JSON.parse(read('manifest.json')),pkg=JSON.parse(read('package.json'));
assert.equal(manifest.name,'FormSentry');assert.equal(manifest.manifest_version,3);assert.equal(manifest.version,pkg.version);
assert.deepEqual(manifest.permissions,['storage','tabs','alarms']);
for(const file of files){assert.ok(fs.existsSync(path.join(root,file)),`Missing release file: ${file}`);if(file.endsWith('.js')){const result=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);}}
for(const file of files.filter(f=>f.endsWith('.html'))){const html=read(file);assert.match(html,/FormSentry/);assert.ok(!/<script\b[^>]*>\s*[^<\s]/i.test(html),`Inline script in ${file}`);const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,`Duplicate HTML IDs: ${file}`);for(const m of html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)){const target=m[1].split('#')[0];if(!/^(https?:|chrome:|data:)/.test(target))assert.ok(files.includes(target),`Broken runtime reference ${file}: ${target}`);}}
for(const n of [16,32,48,128]){const image=fs.readFileSync(path.join(root,`assets/icon-${n}.png`));assert.equal(image.subarray(1,4).toString(),'PNG');assert.equal(image.readUInt32BE(16),n);assert.equal(image.readUInt32BE(20),n);}
const runtime=files.filter(f=>/\.(js|html|json)$/.test(f)).map(read).join('\n');assert.ok(!/sb_secret_|service_role"\s*:|postgres(?:ql)?:\/\//.test(runtime),'Privileged credentials in runtime files');
assert.ok(!/fetch\(cfg\.endpoint/.test(runtime));assert.ok(!/Google Forms Anti-Cheating Monitor|DESKTOP_APPLICATION_OPENED/.test(runtime));
console.log(`Verified ${files.length} runtime files, JavaScript syntax, links, icons, manifest, and credential boundaries.`);
