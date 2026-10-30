/** Dedicated profiles for the remote workflow benchmark. No global plugin changes in isolated mode. */
import { spawnSync } from 'node:child_process';
import { copyFileSync, chmodSync, mkdirSync, existsSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join, basename } from 'node:path';

const clean = () => Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  !/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(k)));
const call = (bin,args,env) => {
  const r=spawnSync(bin,args,{encoding:'utf8',env,timeout:60000});
  if(r.status!==0) throw Error(bin+' '+args.join(' ')+' failed: '+String(r.stderr||r.error?.message||r.status).slice(0,400));
  return r.stdout;
};
function authFile(source,dest) {
  if(!existsSync(source)) return false;
  mkdirSync(resolve(dest,'..'),{recursive:true,mode:0o700});
  copyFileSync(source,dest);chmodSync(dest,0o600);
  return true;
}
function jsonCall(bin,args,env) {
  const result=call(bin,args,env);
  try {return JSON.parse(result)} catch {throw Error(bin+' did not return valid JSON for '+args.join(' '))}
}
function codexMarketplace(env,work,src,arm,isolated) {
  const market='tf-workflow-'+basename(work).toLowerCase().replace(/[^a-z0-9-]/g,'');
  const root=join(work,'marketplace'), target=join(root,'plugins',arm);
  mkdirSync(join(root,'.agents','plugins'),{recursive:true});
  cpSync(src,target,{recursive:true,filter:p=>!p.split(/[\\/]/).includes('.git')});
  writeFileSync(join(root,'.agents','plugins','marketplace.json'),JSON.stringify({
    name:market,plugins:[{name:arm,source:{source:'local',path:'./plugins/'+arm},
    policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Developer Tools'}]}));
  let registered=false;
  const cleanup=()=>{
    if(!registered || isolated) return;
    // Remove ONLY the unique benchmark-owned entry. Leave existing marketplaces untouched.
    jsonCall('codex',['plugin','remove',arm+'@'+market,'--json'],env);
    jsonCall('codex',['plugin','marketplace','remove',market,'--json'],env);
    registered=false;
  };
  try {
    const markets=jsonCall('codex',['plugin','marketplace','list','--json'],env);
    if(JSON.stringify(markets).includes('"'+market+'"')) throw Error('benchmark marketplace already exists');
    const added=jsonCall('codex',['plugin','marketplace','add',root,'--json'],env);
    if(added.marketplaceName!==market || (!isolated && added.alreadyAdded)) throw Error('marketplace identity mismatch');
    registered=true;
    const plugin=jsonCall('codex',['plugin','add',arm+'@'+market,'--json'],env);
    if(plugin.name!==arm || plugin.marketplaceName!==market) throw Error('plugin identity mismatch');
    const list=jsonCall('codex',['plugin','list','--json'],env).installed??[];
    const ours=list.filter(p=>p.marketplaceName===market && p.name===arm && p.installed===true && p.enabled===true);
    if(ours.length!==1 || (isolated && list.length!==1)) throw Error('competitor plugin not enabled exclusively');
    return cleanup;
  } catch(e) {
    try {cleanup()} catch(cleanupErr) {throw Error(e.message+'; plugin cleanup failed: '+cleanupErr.message)}
    throw e;
  }
}
export function makeProfile(agent,arm,work,source,mode) {
  const isolated=mode==='isolated', home=join(work,'home');
  if(isolated) mkdirSync(home,{recursive:true,mode:0o700});
  const env=isolated?{...clean(),HOME:home,XDG_CONFIG_HOME:join(home,'.config')}:{...process.env};
  // GH_TOKEN is intentionally available to the agent for the disposable repository.
  // Use a dedicated token scoped only to benchmark repos; do not run on a production account.
  if(process.env.GH_TOKEN) env.GH_TOKEN=process.env.GH_TOKEN;
  else if(process.env.GITHUB_TOKEN) env.GH_TOKEN=process.env.GITHUB_TOKEN;
  if(agent==='claude') {
    if(isolated) {
      const dir=join(home,'.claude');mkdirSync(dir,{recursive:true,mode:0o700});
      env.CLAUDE_CONFIG_DIR=dir;
      for(const key of ['ANTHROPIC_API_KEY','CLAUDE_CODE_OAUTH_TOKEN']) if(process.env[key]) env[key]=process.env[key];
      if(!env.ANTHROPIC_API_KEY && !env.CLAUDE_CODE_OAUTH_TOKEN)
        authFile(join(resolve(process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude')),'.credentials.json'),join(dir,'.credentials.json'));
    }
    return {env,pluginArgs:arm==='superpowers'||arm==='ponytail'?['--plugin-dir',source]:[],cleanup:()=>{}};
  }
  const codexHome=isolated?join(home,'.codex'):resolve(process.env.CODEX_HOME??join(homedir(),'.codex'));
  if(isolated) {
    mkdirSync(codexHome,{recursive:true,mode:0o700});
    authFile(join(resolve(process.env.CODEX_HOME??join(homedir(),'.codex')),'auth.json'),join(codexHome,'auth.json'));
    env.CODEX_HOME=codexHome;
  } else env.CODEX_HOME=codexHome;
  const cleanup=arm==='superpowers'||arm==='ponytail'?codexMarketplace(env,work,source,arm,isolated):()=>{};
  return {env,pluginArgs:[],cleanup};
}
export function githubGitAuth(env) {
  // Only modifies the selected HOME's git configuration. On an unisolated profile,
  // use repo-local credential helper instead (no global host configuration changes).
  return ['-c','credential.helper=!gh auth git-credential'];
}
export function destroyProfile(work,mode) {
  if(mode==='isolated') rmSync(join(work,'home'),{recursive:true,force:true});
}
