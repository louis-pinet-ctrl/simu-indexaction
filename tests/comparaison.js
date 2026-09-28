// Compare le moteur à un recalcul Python indépendant : python3 tests/verif_independante.py && node tests/comparaison.js tests/verif.json
const fs=require('fs'),vm=require('vm');const ctx={document:{addEventListener(){},createElement(){return{}},head:{appendChild(){}}},console,Intl,Date,Math,JSON,Promise,setTimeout};ctx.window=ctx;vm.createContext(ctx);
for(const f of['indices.js','simu.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
const{calculer,qi,parseDate}=ctx;const V=JSON.parse(fs.readFileSync(process.argv[2]));
const b={sens:'symetrique',tunnel:0,forfait:0,jeu:'auto',dateDemande:null,terme:1};
const cas={exemple:{dateEffet:'2020-07-01',loyerRef:24000,indice:'ILC',refQ:[2020,1],periode:1,pme:true},
sans_pme:{dateEffet:'2020-07-01',loyerRef:24000,indice:'ILC',refQ:[2020,1],periode:1,pme:false},
triennal_icc:{dateEffet:'2017-04-01',loyerRef:18000,indice:'ICC',refQ:[2016,4],periode:3,pme:false},
ilat_trim:{dateEffet:'2019-01-01',loyerRef:40000,indice:'ILAT',refQ:[2018,3],periode:1,pme:false,terme:3},
paye_partiel:{dateEffet:'2018-10-01',loyerRef:30000,indice:'ILC',refQ:[2018,2],periode:1,pme:true,loyerPaye:31200,datePaye:'2021-10-01'}};
let ok=true;
for(const[n,c]of Object.entries(cas)){const d={...b,...c,dateEffet:parseDate(c.dateEffet),refQ:qi(...c.refQ),loyerPaye:c.loyerPaye||c.loyerRef,datePaye:parseDate(c.datePaye||c.dateEffet),dateCalc:parseDate('2026-09-28')};
const R=calculer(d),L=R.ev.map(e=>e.loyer.toFixed(2)),v=V[n];
const same=JSON.stringify(L)===JSON.stringify(v.loyers)&&R.exigible.toFixed(2)===v.exigible&&R.prescrit.toFixed(2)===v.prescrit;ok=ok&&same;
console.log(same?'IDENTIQUE':'ÉCART   ',n,'| JS exigible',R.exigible.toFixed(2),'prescrit',R.prescrit.toFixed(2),same?'':'| PY '+v.exigible+' / '+v.prescrit+' | JS loyers '+L.join(', '))}
console.log(ok?'Tous les scénarios concordent':'Divergences à examiner');
