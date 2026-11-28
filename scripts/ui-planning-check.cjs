// Run after `npm run build` and `npx playwright install chromium`.
const { chromium } = require('playwright');
const {spawn}=require('child_process'); const fs=require('fs'); const os=require('os'); const path=require('path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-ui-')); const port=3471;
(async()=>{const proc=spawn(process.execPath,['src/server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),DB_FILE:path.join(dir,'data.db'),BACKUP_DIR:path.join(dir,'backups'),UPLOADS_DIR:path.join(dir,'uploads')},stdio:'ignore'}); let browser,failed=false;
try {
for(let i=0;i<60;i++){try{if((await fetch(`http://127.0.0.1:${port}/api/tv`)).ok)break;}catch{} await new Promise(r=>setTimeout(r,100));}
browser=await chromium.launch({headless:true,args:['--no-sandbox']});
for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
 const page=await browser.newPage({viewport});const errors=[];let createdId='';page.on('pageerror',e=>errors.push(e.stack));
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
    await page.evaluate(async()=>{const r=await fetch('/api/machines',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${localStorage.getItem('atelier_token')}`},body:JSON.stringify({nom:'Fraiseuse alternative UI',type:'Fraisage CNC'})});if(!r.ok)throw Error('Machine alternative non créée')});
    console.log('✅ UI : type choisi lors de la création de l’OF');
  }
  if(viewport.width<768)await page.locator('nav').getByRole('button',{name:'Planning',exact:true}).click();else await page.getByText('Planning & Gantt',{exact:true}).click();
  await page.getByText('Planning des machines',{exact:true}).waitFor();
  if(viewport.width===1440)await page.locator('aside').getByRole('region',{name:'Copilote atelier'}).waitFor();
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
    await page.getByText('Tester un autre opérateur ou temps').click();
    const proposedEdit=page.locator('details').filter({hasText:'Tester un autre opérateur ou temps'});
    await proposedEdit.locator('input[name="tempsUnitaireMin"]').fill('3');
    await proposedEdit.locator('input[name="tempsReglageMin"]').fill('20');
    const editRequest=page.waitForResponse(r=>r.url().endsWith('/api/planning/drafts/operation')&&r.request().method()==='POST',{timeout:10000}).catch(()=>null);
    await proposedEdit.getByRole('button',{name:'Voir l’effet sur le planning'}).click();
    await page.getByRole('dialog',{name:'Calculer une nouvelle proposition'}).getByRole('button',{name:'Calculer'}).click({timeout:7000});
    const editResult=await editRequest;if(!editResult)throw Error('Requête de proposition non envoyée');if(editResult.status()!==201)throw Error(`Proposition planning : ${await editResult.text()}`);
    await page.getByText('Proposition à vérifier · non publiée').waitFor();
    await page.getByText('Temps prévu :',{exact:false}).first().waitFor();
    console.log('✅ UI planning : proposition opérateur/temps et résultat visible');
    await page.getByRole('button',{name:'Calculer un brouillon'}).click();
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
  const tools=chefPage.getByRole('region',{name:'Les quatre outils du chef'});await tools.waitFor();
  for(const name of [/À surveiller/,/Réagir à un imprévu/,/Matières à suivre/,/Bilan du jour/])await tools.getByRole('button',{name}).waitFor();
  await tools.getByRole('button',{name:/Matières à suivre/}).click();await chefPage.getByText('Matière à suivre',{exact:false}).waitFor();
  await tools.getByRole('button',{name:/Bilan du jour/}).click();await chefPage.getByText('À poursuivre ou préparer',{exact:false}).waitFor();
  console.log('✅ UI chef : quatre cartes visibles et accessibles');

  await chefPage.getByText('Blocages à suivre').waitFor();
  await chefPage.getByText('À surveiller aujourd’hui').waitFor();await chefPage.getByText('Matière à suivre',{exact:false}).waitFor();
  const adaptive=chefPage.waitForResponse(r=>r.url().endsWith('/api/planning/drafts')&&r.request().method()==='POST');
  await chefPage.getByRole('button',{name:'Proposer une adaptation du planning'}).click();
  const adaptResult=await adaptive;if(adaptResult.status()!==201)throw Error(`Adaptation tableau de bord : ${await adaptResult.text()}`);
  await chefPage.getByText('Proposition à vérifier · non publiée').waitFor();
  await chefPage.getByRole('button',{name:'Aujourd’hui',exact:true}).first().click();
  await chefPage.getByText('Bilan du jour et suite').click();
  await chefPage.getByText('À poursuivre ou préparer', {exact:false}).waitFor();
  await chefPage.getByRole('button',{name:'Demander une synthèse'}).click();
  await chefPage.getByText('Aucun fournisseur IA actif.',{exact:false}).waitFor();
  await chefPage.getByRole('button',{name:/Ordres & Gammes/}).click();
  await chefPage.getByRole('button',{name:/Essai type UI/}).click();
  const newMode=chefPage.getByLabel('Mode machine nouvelle étape').first();
  await newMode.selectOption('Fraisage CNC');
  if(await chefPage.getByLabel('Machine imposée nouvelle étape').isVisible())throw Error('Une machine exacte reste imposée en mode automatique');
  await newMode.selectOption('');
  await chefPage.getByRole('button',{name:'Ajouter une consigne opérateur'}).click();
  await chefPage.getByPlaceholder('Ex. : contrôler le bridage avant usinage').fill('Vérifier le bridage avant démarrage');
  const saveInstruction=chefPage.waitForResponse(r=>r.url().includes('/consigne')&&r.request().method()==='PUT');
  await chefPage.getByRole('button',{name:'Enregistrer',exact:true}).click();
  if((await saveInstruction).status()!==200)throw Error('Échec enregistrement consigne');
  await chefPage.getByText('Vérifier le bridage avant démarrage').waitFor();
  console.log('✅ UI chef : tableau de bord, bilan, IA hors ligne et consigne');
  if(await chefPage.getByText('Proposer opérateur ou temps dans le planning').count())throw Error('Formulaire en double encore présent dans la fiche');
  await chefPage.getByRole('button',{name:'Estimation matière',exact:true}).click();
  const fixtureId=await chefPage.evaluate(async()=>{const h={Authorization:`Bearer ${localStorage.getItem('atelier_token')}`};return (await (await fetch('/api/state',{headers:h})).json()).pieces.find(p=>p.nom==='Essai type UI').id});
  if(await chefPage.getByLabel('OF associé').inputValue()!==fixtureId)throw Error('L’OF sélectionné n’est pas repris dans matière');
  if(await chefPage.getByLabel('Quantité (pièces)').inputValue()!=='10')throw Error('Quantité OF non reprise');
  if(await chefPage.getByLabel('Longueur du brut par pièce (mm)').inputValue()!=='')throw Error('Une dimension a été supposée');
  for(const [shape,label] of [['carre','Barre carrée'],['hexagonal','Barre hexagonale'],['tube_rectangulaire','Tube rectangulaire']]){await chefPage.getByLabel('Forme du brut').selectOption(shape);await chefPage.getByLabel(`Schéma ${label}`).waitFor();}
  await chefPage.getByLabel('Forme du brut').selectOption('rond');await chefPage.getByLabel('Matière et densité').selectOption('acier');
  await chefPage.getByLabel('Longueur du brut par pièce (mm)').fill('100');await chefPage.getByLabel('Diamètre extérieur (mm)').fill('50');await chefPage.getByLabel('Perte de coupe par pièce (mm)').fill('5');
  await chefPage.getByLabel('Schéma Barre ronde').waitFor();
  const materialPanel=chefPage.locator('section').filter({has:chefPage.getByRole('heading',{name:'Estimation matière première'})});
  await chefPage.getByRole('button',{name:'Calculer l’estimation'}).click();await materialPanel.getByText('1.050 m').waitFor();
  const saveMaterial=chefPage.waitForResponse(r=>r.url().includes('/material-estimate')&&r.request().method()==='PUT');
  await chefPage.getByRole('button',{name:'Associer cette estimation à l’OF'}).click();await chefPage.getByRole('dialog',{name:'Associer à l’OF'}).getByRole('button',{name:'Associer'}).click();if((await saveMaterial).status()!==200)throw Error('Estimation non associée');
  await chefPage.getByLabel('Perte de coupe par pièce (mm)').fill('4');if(await materialPanel.getByText('1.050 m').count())throw Error('Estimation périmée encore affichée');
  await chefPage.getByRole('button',{name:/Charger l’estimation enregistrée/}).click();await materialPanel.getByText('1.050 m').waitFor();
  // Calculate each new section in the real UI, without changing the saved estimate.
  await chefPage.getByLabel('Forme du brut').selectOption('carre');await chefPage.getByLabel('Côté du carré (mm)').fill('20');await chefPage.getByRole('button',{name:'Calculer l’estimation'}).click();await materialPanel.getByText('3.14 kg').waitFor();
  await chefPage.getByLabel('Forme du brut').selectOption('hexagonal');await chefPage.getByLabel('Distance entre plats (mm)').fill('20');await chefPage.getByRole('button',{name:'Calculer l’estimation'}).click();await materialPanel.getByText('2.72 kg').waitFor();
  await chefPage.getByLabel('Forme du brut').selectOption('tube_rectangulaire');await chefPage.getByLabel('Largeur extérieure (mm)').fill('100');await chefPage.getByLabel('Hauteur extérieure (mm)').fill('50');await chefPage.getByLabel('Épaisseur de paroi (mm)').fill('5');await chefPage.getByRole('button',{name:'Calculer l’estimation'}).click();await materialPanel.getByText('10.99 kg').waitFor();
  await chefPage.getByText('Estimation enregistrée dans',{exact:false}).waitFor();
  await chefPage.getByRole('button',{name:/Ordres & Gammes/}).click();
  await chefPage.getByText('Estimation matière associée',{exact:true}).first().waitFor();
  await chefPage.getByText('1.050 m',{exact:false}).first().waitFor();
  console.log('✅ UI matière : schéma, confirmation intégrée et estimation visible dans la fiche');
  await chefPage.evaluate(async()=>{
    const h={'Content-Type':'application/json',Authorization:`Bearer ${localStorage.getItem('atelier_token')}`};
    const state=await (await fetch('/api/state',{headers:h})).json();const piece=state.pieces.find(p=>p.nom==='Essai type UI');
    const draft=await (await fetch('/api/planning/drafts',{method:'POST',headers:h,body:JSON.stringify({priorityFirst:piece.id})})).json();
    const result=await fetch(`/api/planning/drafts/${draft.id}/publish`,{method:'POST',headers:h,body:'{}'});
    if(!result.ok)throw Error('Publication de la fixture opérateur impossible');
  });
  await chefPage.getByRole('button',{name:'Planning & IA'}).click();
  await chefPage.getByText('Planning des machines',{exact:true}).waitFor();
  await chefPage.getByRole('button',{name:/Discuter avec le copilote/}).click();
  const copilot=chefPage.getByRole('dialog',{name:'Copilote atelier'});await copilot.getByLabel('Votre demande au copilote').fill('Quelle est la situation ?');
  await copilot.getByRole('button',{name:'Demander',exact:true}).click();await copilot.getByRole('alert').getByText('Aucun fournisseur IA actif.',{exact:false}).waitFor();await copilot.getByRole('log').getByText('Quelle est la situation ?').waitFor();
  let messagesSent=[];await chefPage.route('**/api/planning/copilot',async route=>{const body=route.request().postDataJSON();messagesSent.push(body);await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({answer:`Réponse test ${messagesSent.length}`,proposal:null,model:'simulé'})})});
  await copilot.getByLabel('Votre demande au copilote').fill('Première question');await copilot.getByRole('button',{name:'Demander',exact:true}).click();await copilot.getByRole('log').getByText('Réponse test 1').waitFor();
  await copilot.getByLabel('Votre demande au copilote').fill('Et ensuite ?');await copilot.getByRole('button',{name:'Demander',exact:true}).click();await copilot.getByRole('log').getByText('Réponse test 2').waitFor();
  if(!messagesSent[1].history.some(x=>x.text==='Première question')||!messagesSent[1].history.some(x=>x.text==='Réponse test 1'))throw Error('La discussion ne transmet pas le contexte précédent');
  await chefPage.unroute('**/api/planning/copilot');

  await chefPage.keyboard.press('Escape');if(await copilot.isVisible())throw Error('Le volet copilote ne se ferme pas');
  console.log('✅ UI mobile : volet copilote, erreur visible et fermeture');
  await chefPage.getByRole('button',{name:'Calculer un brouillon'}).click();
  await chefPage.getByText('Voir les changements').waitFor();
  const publishResponse=chefPage.waitForResponse(r=>/\/api\/planning\/drafts\/[^/]+\/publish$/.test(r.url())&&r.request().method()==='POST');
  await chefPage.getByRole('button',{name:'Confirmer et publier'}).click();
  await chefPage.getByRole('dialog',{name:'Publier le planning'}).getByRole('button',{name:'Publier'}).click();
  const published=await publishResponse;if(published.status()!==200)throw Error(`Publication UI : ${await published.text()}`);
  console.log('✅ UI chef mobile : planning, confirmation intégrée et publication réelle');
 } catch(e) {failed=true;console.error('❌ UI chef mobile',e.message)} finally {await chefPage.close()}
 const adminPage=await browser.newPage({viewport:{width:1440,height:900}});
 try {await adminPage.goto(`http://127.0.0.1:${port}/`);await adminPage.getByRole('button',{name:'Directeur',exact:true}).click();await adminPage.getByText('Comptes & Audit',{exact:true}).click();await adminPage.getByText('Tokens IA par utilisateur').waitFor();await adminPage.getByLabel('Limite quotidienne Chef Atelier').fill('12345');const row=adminPage.locator('form').filter({has:adminPage.getByLabel('Limite quotidienne Chef Atelier')});const saved=adminPage.waitForResponse(r=>r.url().endsWith('/api/admin/ai-usage/u3/limit'));await row.getByRole('button',{name:'Enregistrer'}).click();if((await saved).status()!==200)throw Error('Limite non enregistrée');console.log('✅ UI directeur : compteur et limite par utilisateur');}catch(e){failed=true;console.error('❌ UI directeur limites',e.message)}finally{await adminPage.close()}
 const opPage=await browser.newPage({viewport:{width:390,height:844}});
 try{await opPage.goto(`http://127.0.0.1:${port}/`);await opPage.getByRole('button',{name:'Opérateur',exact:true}).click();await opPage.getByText('Vérifier le bridage avant démarrage').waitFor();console.log('✅ UI opérateur : consigne reçue');}
 catch(e){failed=true;console.error('❌ UI opérateur consigne',e.message)}finally{await opPage.close()}
} catch(e){failed=true;console.error(e.message)} finally {if(browser)await browser.close();proc.kill();fs.rmSync(dir,{recursive:true,force:true});}
if(failed)process.exitCode=1;
})();
