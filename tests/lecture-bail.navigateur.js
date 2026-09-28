// Parcours de lecture du bail avec une réponse serveur simulée (Playwright) : SP=<dossier contenant bail.pdf> node tests/lecture-bail.navigateur.js
const {chromium}=require('playwright');
const C=(v,e,p,c)=>({valeur:v,extrait:e,page:p,confiance:c});
const DONNEES={document_est_un_bail:true,
date_effet:C('2020-07-01','Le présent bail prend effet le 1er juillet 2020.',2,'certain'),
loyer_annuel_ht:C(24000,'moyennant un loyer annuel de vingt-quatre mille euros hors taxes et hors charges',5,'certain'),
indice:C('ILC','indice des loyers commerciaux publié par l\'INSEE',6,'certain'),
indice_base_mode:C('dernier_publie','l\'indice de référence sera le dernier indice publié à la date de prise d\'effet',6,'certain'),
indice_base_trimestre:C(0,'',0,'absent'),indice_base_annee:C(0,'',0,'absent'),
periodicite:C('annuelle','révisé chaque année à la date anniversaire',6,'certain'),
sens:C('symetrique','',6,'probable'),taux:C(0,'',0,'absent'),
jeu:C('auto','de plein droit, sans qu\'il soit besoin d\'aucune notification',6,'certain'),
echeances:C('mensuelles','payable mensuellement et d\'avance',5,'certain'),
avertissements:['La clause ne précise pas le sens de la variation : indexation retenue dans les deux sens.']};
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
for(const w of [900,390]){const p=await b.newPage({viewport:{width:w,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
let recu=null;
await p.route('**/lecture-bail',async r=>{recu=JSON.parse(r.request().postData());await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,donnees:DONNEES})})});
await p.goto('file://'+process.cwd()+'/index.html');
await p.setInputFiles('#bail_fichiers',process.env.SP+'/bail.pdf');
console.log('bouton avant consentement désactivé',await p.isDisabled('#btn-lire'));
await p.check('#bail_consent');await p.click('#btn-lire');await p.waitForSelector('#lu:not([hidden])');
console.log('envoyé',recu.fichiers.length,recu.fichiers[0].type,recu.consentement);
console.log('champs',await p.inputValue('#date_effet'),await p.inputValue('#loyer_ref'),await p.inputValue('#ref_trim'),await p.inputValue('#ref_annee'),await p.textContent('#depot-etat'));
await (await p.$('.step.active')).screenshot({path:process.env.SP+'/lu'+w+'.png'});
console.log(w,'overflow',await p.evaluate(()=>document.documentElement.scrollWidth),errs)}
await b.close()})();
