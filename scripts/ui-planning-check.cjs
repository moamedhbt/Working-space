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
  const mutations=[];const navListener=req=>{if(req.url().includes('/api/')&&!['GET','HEAD'].includes(req.method()))mutations.push(`${req.method()} ${req.url()}`)};
  page.on('request',navListener);
  await page.getByRole('button',{name:'Semaine',exact:true}).click();
  await page.getByRole('button',{name:'Mois',exact:true}).click();
  const year=await page.evaluate(()=>new Date().getFullYear());
  if(await page.getByRole('button',{name:/^Ouvrir .* \d{4}$/}).count()!==12)throw Error('La vue annuelle ne montre pas exactement 12 mois');
  await page.getByRole('button',{name:'Période suivante'}).click();
  await page.getByRole('button',{name:`Ouvrir janvier ${year+1}`,exact:true}).waitFor();
  await page.getByRole('button',{name:'Période précédente'}).click();
  await page.getByRole('button',{name:`Ouvrir janvier ${year}`,exact:true}).click();
  await page.getByRole('button',{name:'← Retour aux 12 mois'}).waitFor();
  await page.getByRole('button',{name:`Ouvrir la journée ${year}-01-01`,exact:true}).click();
  if(await page.getByRole('button',{name:'Jour',exact:true}).getAttribute('aria-pressed')!=='true')throw Error('Le jour sélectionné ne s’ouvre pas');
  await page.getByRole('button',{name:'Semaine',exact:true}).click();
  if(await page.getByRole('button',{name:'Semaine',exact:true}).getAttribute('aria-pressed')!=='true')throw Error('La vue semaine ne s’ouvre pas');
  await page.getByRole('button',{name:'Aujourd’hui',exact:true}).click();
  await page.getByRole('button',{name:'Jour',exact:true}).click();
  page.off('request',navListener);if(mutations.length)throw Error(`Navigation a modifié des données : ${mutations.join(', ')}`);
  console.log(`✅ UI ${viewport.width} : année, 12 mois, mois → jour et navigation sans modification`);
  if(createdId) await page.getByLabel('OF à avancer').selectOption(createdId);
  const draftResponse=page.waitForResponse(r=>r.url().endsWith('/api/planning/drafts')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Calculer un brouillon'}).click();await page.getByText('Voir les changements').waitFor();
  const draft=await (await draftResponse).json();
  if(createdId) {
    const item=draft.operations.find(o=>o.pieceId===createdId);if(!item)throw Error('Opération créée absente du brouillon');
    const first=item.segments[0], target=new Date(first.date+'T12:00:00');
    await page.getByRole('button',{name:'Mois',exact:true}).click();
    const firstMonth=new Date(first.date+'T12:00:00').toLocaleDateString('fr-FR',{month:'long',year:'numeric'});
    const firstYear=Number(first.date.slice(0,4)),currentYear=new Date().getFullYear();
    for(let i=currentYear;i<firstYear;i++)await page.getByRole('button',{name:'Période suivante'}).click();
    const monthCard=page.getByRole('button',{name:`Ouvrir ${firstMonth}`,exact:true});
    const monthText=await monthCard.textContent();if(!/[1-9]\d* OF affiché/.test(monthText))throw Error('Le mois du brouillon ne compte pas les OF affichés');
    await page.getByRole('button',{name:'Aujourd’hui',exact:true}).click();
    await page.getByRole('button',{name:'Jour',exact:true}).click();
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
  await chefPage.getByText('Aujourd’hui dans l’atelier').waitFor();
  await chefPage.getByText('Blocages à suivre').waitFor();
  await chefPage.getByText('Bilan du jour et suite').click();
  await chefPage.getByText('À poursuivre ou préparer', {exact:false}).waitFor();
  await chefPage.getByRole('button',{name:'Demander une synthèse'}).click();
  await chefPage.getByText('Aucun fournisseur IA actif.',{exact:false}).waitFor();
  await chefPage.getByRole('button',{name:/Ordres & Gammes/}).click();
  await chefPage.getByRole('button',{name:/Essai type UI/}).click();
  await chefPage.getByRole('button',{name:'Ajouter une consigne opérateur'}).click();
  await chefPage.getByPlaceholder('Ex. : contrôler le bridage avant usinage').fill('Vérifier le bridage avant démarrage');
  const saveInstruction=chefPage.waitForResponse(r=>r.url().includes('/consigne')&&r.request().method()==='PUT');
  await chefPage.getByRole('button',{name:'Enregistrer',exact:true}).click();
  if((await saveInstruction).status()!==200)throw Error('Échec enregistrement consigne');
  await chefPage.getByText('Vérifier le bridage avant démarrage').waitFor();
  console.log('✅ UI chef : tableau de bord, bilan, IA hors ligne et consigne');
  await chefPage.evaluate(async()=>{
    const h={'Content-Type':'application/json',Authorization:`Bearer ${localStorage.getItem('atelier_token')}`};
    const state=await (await fetch('/api/state',{headers:h})).json();const piece=state.pieces.find(p=>p.nom==='Essai type UI');
    const draft=await (await fetch('/api/planning/drafts',{method:'POST',headers:h,body:JSON.stringify({priorityFirst:piece.id})})).json();
    const result=await fetch(`/api/planning/drafts/${draft.id}/publish`,{method:'POST',headers:h,body:'{}'});
    if(!result.ok)throw Error('Publication de la fixture opérateur impossible');
  });
  await chefPage.getByRole('button',{name:'Planning & IA'}).click();
  await chefPage.getByText('Planning des machines',{exact:true}).waitFor();
  await chefPage.getByRole('button',{name:'Calculer un brouillon'}).click();
  await chefPage.getByText('Voir les changements').waitFor();
  console.log('✅ UI chef mobile : planning et brouillon OK');
 } catch(e) {failed=true;console.error('❌ UI chef mobile',e.message)} finally {await chefPage.close()}
 const opPage=await browser.newPage({viewport:{width:390,height:844}});
 try{await opPage.goto(`http://127.0.0.1:${port}/`);await opPage.getByRole('button',{name:'Opérateur',exact:true}).click();await opPage.getByText('Vérifier le bridage avant démarrage').waitFor();console.log('✅ UI opérateur : consigne reçue');}
 catch(e){failed=true;console.error('❌ UI opérateur consigne',e.message)}finally{await opPage.close()}
} catch(e){failed=true;console.error(e.message)} finally {if(browser)await browser.close();proc.kill();fs.rmSync(dir,{recursive:true,force:true});}
if(failed)process.exitCode=1;
})();
