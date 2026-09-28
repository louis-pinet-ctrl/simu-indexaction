// Contrôle du moteur de calcul : node tests/calcul.test.js
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const ctx={window:{},document:{addEventListener(){},createElement(){return{}},head:{appendChild(){}}},console,Intl,Date,Math,JSON,Promise,setTimeout,clearTimeout};
ctx.window=ctx;vm.createContext(ctx);
for(const f of['indices.js','simu.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),ctx);
const{calculer,qi,parseDate,idx}=ctx;
const base={indice:'ILC',periode:1,sens:'symetrique',tunnel:0,jeu:'auto',dateDemande:null,pme:false,terme:1};
let n=0;function t(nom,fn){fn();n++;console.log('ok',nom)}

t('sans plafond, le loyer suit exactement le rapport des indices',()=>{
  const d={...base,dateEffet:parseDate('2016-01-01'),loyerRef:30000,refQ:qi(2015,3),loyerPaye:30000,datePaye:parseDate('2016-01-01'),dateCalc:parseDate('2026-09-28')};
  const R=calculer(d);const last=R.ev[R.ev.length-1];
  assert.strictEqual(R.ev.length,10);
  assert.ok(Math.abs(last.loyer-Math.round(30000*idx('ILC',qi(2025,3))/idx('ILC',qi(2015,3))*100)/100)<0.011);
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
console.log(n+' tests passés');
