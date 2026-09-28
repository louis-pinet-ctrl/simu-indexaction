// Contrôle du moteur de calcul : node tests/calcul.test.js
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const ctx={window:{},document:{addEventListener(){},createElement(){return{}},head:{appendChild(){}}},console,Intl,Date,Math,JSON,Promise,setTimeout,clearTimeout};
ctx.window=ctx;vm.createContext(ctx);
for(const f of['indices.js','simu.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),ctx);
const{calculer,qi,parseDate,idx,chronologie,tauxEffort}=ctx;const EXEMPLE=vm.runInContext('EXEMPLE',ctx);
const base={indice:'ILC',periode:1,sens:'symetrique',tunnel:0,jeu:'auto',dateDemande:null,pme:false,terme:1};
let n=0;function t(nom,fn){fn();n++;console.log('ok',nom)}

t('sans plafond, le loyer suit exactement le rapport des indices',()=>{
  const d={...base,dateEffet:parseDate('2016-01-01'),loyerRef:30000,refQ:qi(2015,3),loyerPaye:30000,datePaye:parseDate('2016-01-01'),dateCalc:parseDate('2026-09-28')};
  const R=calculer(d);const last=R.ev[R.ev.length-1];
  assert.strictEqual(R.ev.length,10);
  assert.ok(Math.abs(last.loyer-30000*idx('ILC',qi(2025,3))/idx('ILC',qi(2015,3)))<0.10,'écart '+last.loyer);
  R.ev.forEach(e=>assert.strictEqual(e.loyer,Math.round(e.prec*e.ratio*100)/100));
});

t('bouclier PME : aucune variation annuelle retenue au-delà de 3,5 % sur la période',()=>{
  const d={...base,pme:true,dateEffet:parseDate('2021-10-01'),loyerRef:24000,refQ:qi(2021,2),loyerPaye:24000,datePaye:parseDate('2021-10-01'),dateCalc:parseDate('2026-09-28')};
  const R=calculer(d);
  R.ev.filter(e=>e.comp>=qi(2022,2)&&e.comp<=qi(2024,1)).forEach(e=>assert.ok(e.variation<=0.035+1e-9,'variation '+e.variation));
  const sans=calculer({...d,pme:false});
  assert.ok(sans.loyerDu>R.loyerDu,'le bouclier doit réduire le loyer');
});

t('rattrapage : cinq ans exigibles, le reste prescrit',()=>{
  const d={...base,dateEffet:parseDate('2017-01-01'),loyerRef:20000,refQ:qi(2016,3),loyerPaye:20000,datePaye:parseDate('2017-01-01'),dateCalc:parseDate('2026-09-28')};
  const R=calculer(d);
  assert.ok(R.exigible>0&&R.prescrit>0);
  R.annees.forEach(l=>{if(l.annee<2021)assert.ok(l.prescrit)});
});

t('clause sur demande sans demande : aucun rappel',()=>{
  const d={...base,jeu:'demande',dateEffet:parseDate('2019-01-01'),loyerRef:20000,refQ:qi(2018,3),loyerPaye:20000,datePaye:parseDate('2019-01-01'),dateCalc:parseDate('2026-09-28')};
  assert.strictEqual(calculer(d).exigible,0);
});

t('triennale : une seule indexation tous les trois ans',()=>{
  const d={...base,periode:3,dateEffet:parseDate('2017-04-01'),loyerRef:18000,refQ:qi(2016,4),loyerPaye:18000,datePaye:parseDate('2017-04-01'),dateCalc:parseDate('2026-09-28')};
  const R=calculer(d);assert.strictEqual(R.ev.length,3);assert.strictEqual(R.ev[0].comp,qi(2019,4));
});

t('loyer payé égal au loyer dû : écart nul',()=>{
  const d={...base,dateEffet:parseDate('2025-01-01'),loyerRef:20000,refQ:qi(2024,3),dateCalc:parseDate('2025-12-31'),loyerPaye:20000,datePaye:parseDate('2025-01-01')};
  assert.ok(Math.abs(calculer(d).exigible)<0.01);
});

t('mensualités : douze échéances égales au douzième du loyer',()=>{
  const d={...base,dateEffet:parseDate('2025-01-01'),loyerRef:24000,refQ:qi(2024,3),dateCalc:parseDate('2025-12-31'),loyerPaye:24000,datePaye:parseDate('2025-01-01')};
  const R=calculer(d);const l=R.annees.find(a=>a.annee===2025);assert.ok(Math.abs(l.paye-24000)<0.01,'payé '+l.paye);
});
t('clause à la hausse seule : le trop-payé du locataire apparaît quand l\'indice baisse',()=>{
  const d={...base,sens:'hausse',dateEffet:parseDate('2024-07-01'),loyerRef:30000,refQ:qi(2024,3),dateCalc:parseDate('2026-09-28'),loyerPaye:30000,datePaye:parseDate('2024-07-01')};
  const R=calculer(d);assert.ok(R.loyerDu<30000);assert.ok(R.exigible<0);
});
t('hausse forfaitaire réputée non écrite : restitution calculée sur le loyer de référence',()=>{
  const d={...base,sens:'forfait',forfait:1.5,dateEffet:parseDate('2018-01-01'),loyerRef:20000,refQ:qi(2017,3),dateCalc:parseDate('2026-09-28'),loyerPaye:r(20000*Math.pow(1.015,8)),datePaye:parseDate('2026-01-01')};
  const R=calculer(d);assert.strictEqual(R.loyerDu,20000);assert.ok(R.exigible<0);
  // cinq dernières années : trop-payé = somme des hausses perçues
  assert.ok(Math.abs(R.exigible)>5000&&Math.abs(R.exigible)<9000,'trop-payé '+R.exigible);
});
function r(x){return Math.round(x*100)/100}
t('exemple commenté : montants stables et chronologie complète',()=>{
  const R=calculer(EXEMPLE);assert.strictEqual(R.exigible,9073.31);assert.strictEqual(R.prescrit,25.81);assert.strictEqual(R.ev.length,6);
  const h=chronologie(EXEMPLE,R);assert.ok(h.includes('Limite de prescription')&&h.includes('103,24'));
});
t('taux d\'effort : avant, après, année du rattrapage',()=>{
  const d={...EXEMPLE,ca:320000,charges:3000};const R=calculer(d),L=tauxEffort(d,R);
  assert.strictEqual(L.length,4);
  assert.ok(Math.abs(L[0].v-27000/320000)<1e-9);
  assert.ok(Math.abs(L[2].v-(R.loyerDu+3000+R.exigible)/320000)<1e-9);
  assert.strictEqual(tauxEffort({...EXEMPLE,ca:0},R),null);
});
t('ampleur : exemple qualifié de forte augmentation',()=>{
  const R=calculer(EXEMPLE),A=ctx.ampleur(EXEMPLE,R);
  assert.strictEqual(A.niv.lib,'Forte augmentation');
  assert.ok(Math.abs(A.h-(26813.02/24000-1))<1e-9);
  assert.ok(Math.abs(A.mois-9073.31/(26813.02/12))<1e-9);
});
t('prise d\'effet en cours de mois : prorata et rendus sans erreur',()=>{
  const d={...EXEMPLE,dateEffet:parseDate('2020-07-15'),datePaye:parseDate('2020-07-15')};const R=calculer(d);
  const premiere=R.detail[0];assert.ok(premiere.du<24000/12&&premiere.du>0,'prorata '+premiere.du);
  const h=ctx.friseCourte(d,R)+ctx.calculsTypes(d,R)+chronologie(d,R);assert.ok(h.includes('prorata')||h.includes('/12'));
});
t('valeurs lues invraisemblables : aucune case cochée',()=>{
  assert.strictEqual(ctx.cocher('sens','x"]'),false);
});
t('indexation au 1er janvier : distorsion détectée en mode « même trimestre », pas en mode « dernier publié »',()=>{
  const d={...base,dateEffet:parseDate('2020-07-01'),premiereIndex:parseDate('2021-01-01'),loyerRef:24000,refQ:qi(2020,1),loyerPaye:24000,datePaye:parseDate('2020-07-01'),dateCalc:parseDate('2026-09-28')};
  const R=calculer({...d,compMode:'meme'});
  assert.ok(R.distorsion&&R.distorsion.date.getTime()===parseDate('2021-01-01').getTime(),'distorsion attendue à la première indexation');
  assert.strictEqual(Math.round(R.distorsion.moisIdx),12);assert.strictEqual(Math.round(R.distorsion.moisRev),6);
  const D=calculer({...d,compMode:'dernier'});
  assert.strictEqual(D.distorsion,null);assert.strictEqual(D.ev[0].comp,qi(2020,3));assert.strictEqual(D.ev[1].comp,qi(2021,3));
});
t('date de première indexation libre : les indexations suivent cette date, pas l\'anniversaire du bail',()=>{
  const d={...base,dateEffet:parseDate('2019-03-15'),premiereIndex:parseDate('2020-01-01'),loyerRef:20000,refQ:qi(2018,4),loyerPaye:20000,datePaye:parseDate('2019-03-15'),dateCalc:parseDate('2026-09-28')};
  const R=calculer(d);R.ev.forEach((e,k)=>{assert.strictEqual(e.date.getUTCMonth(),0);assert.strictEqual(e.date.getUTCFullYear(),2020+k)});
});
t('paliers de loyer payé : chaque année reprend le montant en vigueur',()=>{
  const d={...base,dateEffet:parseDate('2023-01-01'),loyerRef:24000,refQ:qi(2022,3),dateCalc:parseDate('2025-12-31'),
    paliers:[{date:parseDate('2025-01-01'),montant:25200},{date:parseDate('2023-01-01'),montant:24000}]};
  const R=calculer(d);
  assert.strictEqual(d.loyerPaye,25200);assert.strictEqual(d.datePaye.getTime(),parseDate('2023-01-01').getTime());
  const a24=R.annees.find(a=>a.annee===2024),a25=R.annees.find(a=>a.annee===2025);
  assert.ok(Math.abs(a24.paye-24000)<0.01,'payé 2024 '+a24.paye);assert.ok(Math.abs(a25.paye-25200)<0.01,'payé 2025 '+a25.paye);
  assert.ok(Math.abs(R.exigible-(a24.ecart+a25.ecart+R.annees.find(a=>a.annee===2023).ecart))<0.01);
});
t('clause plancher : le loyer dû suit l\'indice à la baisse, le trop-payé apparaît',()=>{
  const d={...base,sens:'plancher',dateEffet:parseDate('2024-07-01'),loyerRef:30000,refQ:qi(2024,3),dateCalc:parseDate('2026-09-28'),loyerPaye:30000,datePaye:parseDate('2024-07-01')};
  const R=calculer(d);assert.ok(R.loyerDu<30000);assert.ok(R.exigible<0);
  R.ev.forEach(e=>assert.ok(e.loyerHausse>=30000));
});
t('dépôt de garantie indexé : complément proportionnel au loyer dû',()=>{
  const R=calculer({...EXEMPLE,depot:6000,depotIndexe:true});
  assert.ok(R.depot);assert.strictEqual(R.depot.du,r(6000*R.loyerDu/24000));assert.strictEqual(R.depot.complement,r(R.depot.du-6000));
  assert.strictEqual(calculer({...EXEMPLE,depot:6000,depotIndexe:false}).depot,null);
});
t('intérêts au taux légal : par échéance, depuis la mise en demeure, taux personne physique plus élevé',()=>{
  const d={...EXEMPLE,dateMED:parseDate('2025-01-15'),bailleurPhysique:false};const R=calculer(d);
  assert.ok(R.interets&&R.interets.total>0);
  // assiette = échéances impayées non prescrites, positives
  const att=R.detail.filter(p=>!p.prescrit&&p.du-p.paye>0.005).reduce((s,p)=>s+p.du-p.paye,0);
  assert.ok(Math.abs(R.interets.assiette-att)<0.01,'assiette '+R.interets.assiette+' / '+att);
  // borne haute : taux le plus fort sur toute l'assiette pendant toute la durée
  const jours=(d.dateCalc-d.dateMED)/86400000;assert.ok(R.interets.total<att*0.0371*jours/365+0.01);
  const P=calculer({...d,bailleurPhysique:true});assert.ok(P.interets.total>R.interets.total);
  assert.strictEqual(calculer({...EXEMPLE,dateMED:null}).interets,null);
  assert.ok(calculer({...d,dateMED:parseDate('2022-01-01')}).interets.tronque);
});
t('taux légal : série semestrielle ordonnée, taux personne physique toujours supérieur',()=>{
  const T=vm.runInContext('TAUX_LEGAL',ctx);
  for(let i=1;i<T.length;i++)assert.ok(T[i].debut>T[i-1].debut);
  T.forEach(x=>assert.ok(x.pp>x.autres&&x.autres>0));
});
console.log(n+' tests passés');
