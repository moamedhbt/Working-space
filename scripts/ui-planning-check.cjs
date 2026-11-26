// Run after `npm run build` and `npx playwright install chromium`.
const { chromium } = require('playwright');
const {spawn}=require('child_process'); const fs=require('fs'); const os=require('os'); const path=require('path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-ui-')); const port=3471;
(async()=>{const proc=spawn(process.execPath,['src/server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),DB_FILE:path.join(dir,'data.db'),BACKUP_DIR:path.join(dir,'backups'),UPLOADS_DIR:path.join(dir,'uploads')},stdio:'ignore'}); let browser,failed=false;
try {
for(let i=0;i<60;i++){try{if((await fetch(`http://127.0.0.1:${port}/api/tv`)).ok)break;}catch{} await new Promise(r=>setTimeout(r,100));}
browser=await chromium.launch({headless:true,args:['--no-sandbox']});
for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
 const page=await browser.newPage({viewport});const errors=[];let createdId='';page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(`http://127.0.0.1:${port}/`);await page.getByRole('button',{name:'Directeur',exact:true}).click();
  if(viewport.width===1440) {
    await page.getByRole('button',{name:'Nouvelle pièce'}).click();
    await page.getByPlaceholder('Ex: Arbre de transmission Ø50').fill('Essai type UI');
    await page.locator('select').filter({has:page.locator('option[value="Fraisage CNC"]')}).first().selectOption('Fraisage CNC');
    const response=page.waitForResponse(r=>r.url().endsWith('/api/pieces')&&r.request().method()==='POST');
    await page.getByRole('button',{name:"Créer l'OF",exact:true}).click();
    const created=await (await response).json();
    const state=await page.evaluate(async()=>{const token=localStorage.getItem('atelier_token');return (await fetch('/api/state',{headers:{Authorization:`Bearer ${token}`}})).json()});
    if(state.pieces.find(p=>p.id===created.id)?.operations[0]?.machineTypeRequis!=='Fraisage CNC') throw Error('Le type choisi à la création ne parvient pas à la gamme');
    createdId=created.id;
    await page.evaluate(async id=>{const h={'Content-Type':'application/json',Authorization:`Bearer ${localStorage.getItem('atelier_token')}`}; for(const action of ['be-validate','chef-validate']){const r=await fetch(`/api/pieces/${id}/${action}`,{method:'POST',headers:h,body:'{}'});if(!r.ok)throw Error(`Validation ${action} failed`) }},createdId);
    console.log('✅ UI : type choisi lors de la création de l’OF');
  }
  if(viewport.width<768)await page.locator('nav').getByRole('button',{name:'Planning',exact:true}).click();else await page.getByText('Planning & Gantt',{exact:true}).click();
  await page.getByText('Planning des machines',{exact:true}).waitFor();
  for(const mode of ['Semaine','Mois','Jour']) await page.getByRole('button',{name:mode,exact:true}).click();
  if(createdId) await page.getByLabel('OF à avancer').selectOption(createdId);
  const draftResponse=page.waitForResponse(r=>r.url().endsWith('/api/planning/drafts')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Calculer un brouillon'}).click();await page.getByText('Voir les changements').waitFor();
  const draft=await (await draftResponse).json();
  if(createdId) {
    const item=draft.operations.find(o=>o.pieceId===createdId);if(!item)throw Error('Opération créée absente du brouillon');
    const first=item.segments[0], target=new Date(first.date+'T12:00:00');
    const diff=await page.evaluate(date=>{const now=new Date();now.setHours(12,0,0,0);return Math.round((new Date(date+'T12:00:00')-now)/86400000)},first.date);
    if(diff<0 || diff>60)throw Error('Date de test inattendue');
    for(let i=0;i<diff;i++)await page.getByRole('button',{name:'Période suivante'}).click();
    await page.locator('button[title]').filter({hasText:createdId}).first().click();
    await page.getByLabel('Date proposée').waitFor();
    target.setDate(target.getDate()+35);
    while(![0,1,2,3,4].includes(target.getDay()))target.setDate(target.getDate()+1);
    const destination=`${target.getFullYear()}-${String(target.getMonth()+1).padStart(2,'0')}-${String(target.getDate()).padStart(2,'0')}`;
    await page.getByLabel('Date proposée').fill(destination);await page.getByLabel('Heure proposée').fill('08:00');
    const moveResponse=page.waitForResponse(r=>r.url().endsWith('/api/planning/drafts/move')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Préparer le déplacement'}).click();const moved=await moveResponse;
    if(moved.status()!==201)throw Error(`Déplacement UI : ${await moved.text()}`);
    console.log('✅ UI : déplacement dans le brouillon existant');
  }
  if(errors.length)throw Error(errors.join('; '));console.log(`✅ UI ${viewport.width} : navigation et brouillon OK`);
 }catch(e){failed=true;console.error(`❌ UI ${viewport.width}`,e.message)}finally{await page.close()}
}
 const chefPage=await browser.newPage({viewport:{width:390,height:844}});
 try {
  await chefPage.goto(`http://127.0.0.1:${port}/`);
  await chefPage.getByRole('button',{name:'Chef Atelier',exact:true}).click();
  await chefPage.getByRole('button',{name:'Planning & IA'}).click();
  await chefPage.getByText('Planning des machines',{exact:true}).waitFor();
  await chefPage.getByRole('button',{name:'Calculer un brouillon'}).click();
  await chefPage.getByText('Voir les changements').waitFor();
  console.log('✅ UI chef mobile : planning et brouillon OK');
 } catch(e) {failed=true;console.error('❌ UI chef mobile',e.message)} finally {await chefPage.close()}
} catch(e){failed=true;console.error(e.message)} finally {if(browser)await browser.close();proc.kill();fs.rmSync(dir,{recursive:true,force:true});}
if(failed)process.exitCode=1;
})();
