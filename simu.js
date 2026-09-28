// Simulateur d'indexation du loyer commercial - Louis Pinet, avocat des restaurateurs.
// Les indices sont dans indices.js (window.INDICES), mis à jour chaque trimestre.
function loadScript(u){return new Promise(function(r,j){var s=document.createElement('script');s.src=u;s.onload=r;s.onerror=j;document.head.appendChild(s)})}
loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js').catch(function(){});

const CALENDLY_URL='https://calendly.com/louispinet_avocatdesrestaurateurs/30min';
// Remontée du lead vers Supabase puis Brevo, une seule fois par simulation.
const LEAD_ENDPOINT='https://tcnzmfcmihwzoaaffgfz.supabase.co/functions/v1/leads-site?src=indexation';
const PRESCRIPTION_ANS=5;
const BOUCLIER={debut:qi(2022,2),fin:qi(2024,1),taux:0.035};
const NOM_INDICE={ILC:'indice des loyers commerciaux (ILC)',ILAT:'indice des loyers des activités tertiaires (ILAT)',ICC:'indice du coût de la construction (ICC)'};
let currentStep=1,resultat=null,narrativeText='',currentRole='preneur',currentType='analyse_p';

// ---------- Outils ----------
function qi(y,q){return y*4+(q-1)}
function qKey(i){return Math.floor(i/4)+'-T'+(i%4+1)}
function qLabel(i){const q=i%4+1;return (q===1?'1er':q+'e')+' trim. '+Math.floor(i/4)}
function idx(indice,i){const s=(window.INDICES||{})[indice]||{};const v=s[qKey(i)];return typeof v==='number'?v:null}
function toNum(v){if(v==null)return 0;v=String(v).replace(/[\s  €]/g,'').replace(/\.(?=\d{3}(\D|$))/g,'').replace(',','.');const n=parseFloat(v);return isFinite(n)&&n>0?n:0}
function num(id){return toNum(document.getElementById(id).value)}
function parseDate(s){if(!s)return null;const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);return m?new Date(Date.UTC(+m[1],+m[2]-1,+m[3])):null}
function isoDate(d){return d.toISOString().slice(0,10)}
function addYears(d,n){const r=new Date(Date.UTC(d.getUTCFullYear()+n,d.getUTCMonth(),d.getUTCDate()));if(r.getUTCDate()!==d.getUTCDate())r.setUTCDate(0);return r}
function addMonths(d,n){return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+n,1))}
function days(a,b){return Math.round((b-a)/86400000)}
function fmtDate(d){return d?d.toLocaleDateString('fr-FR',{timeZone:'UTC',day:'2-digit',month:'2-digit',year:'numeric'}):'-'}
function fmtLong(d){if(!d)return'-';const t=d.toLocaleDateString('fr-FR',{timeZone:'UTC',day:'numeric',month:'long',year:'numeric'});return t.replace(/^1 /,'1er ')}
function euro(n,dec){return new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',minimumFractionDigits:dec?2:0,maximumFractionDigits:dec?2:0}).format(n)}
function pct(x){return (x>=0?'+':'')+(x*100).toFixed(2).replace('.',',')+' %'}
function fr(n,d){return n.toFixed(d).replace('.',',')}
function r2(n){return Math.round(n*100)/100}
function radio(name){const c=document.querySelector('#simu-index input[name="'+name+'"]:checked');return c?c.value:null}
function cap(s){return s.charAt(0).toUpperCase()+s.slice(1)}
function today(){const n=new Date();return new Date(Date.UTC(n.getFullYear(),n.getMonth(),n.getDate()))}

// Date de publication approximative d'un trimestre : fin du trimestre suivant (T1 fin juin, T4 fin mars).
function datePublication(i){const y=Math.floor(i/4),q=i%4+1;return new Date(Date.UTC(q===4?y+1:y,q===4?2:q*3+2,20))}
function dernierIndicePublie(indice,d){let i=qi(d.getUTCFullYear(),Math.floor(d.getUTCMonth()/3)+1);for(let n=0;n<8;n++,i--){if(datePublication(i)<=d&&idx(indice,i)!=null)return i}return null}
function dernierTrimestreDispo(indice){const s=(window.INDICES||{})[indice]||{};let best=null;Object.keys(s).forEach(k=>{const m=/^(\d{4})-T([1-4])$/.exec(k);if(m&&typeof s[k]==='number'){const i=qi(+m[1],+m[2]);if(best===null||i>best)best=i}});return best}

// ---------- Moteur de calcul ----------
// Taux de l'intérêt légal (arrêtés publiés au JO), par semestre : créancier personne physique
// n'agissant pas pour des besoins professionnels, et tous les autres cas.
const TAUX_LEGAL=[
{debut:'2024-01-01',pp:8.01,autres:5.07},{debut:'2024-07-01',pp:8.16,autres:4.92},
{debut:'2025-01-01',pp:7.21,autres:3.71},{debut:'2025-07-01',pp:6.65,autres:2.76},
{debut:'2026-01-01',pp:6.67,autres:2.62},{debut:'2026-07-01',pp:6.84,autres:2.75}];
function moisEntre(a,b){return (b.getUTCFullYear()-a.getUTCFullYear())*12+(b.getUTCMonth()-a.getUTCMonth())+(b.getUTCDate()-a.getUTCDate())/30}
function hausseSeule(d){return d.sens==='hausse'||d.sens==='plancher'}
function champPaye(d){return hausseSeule(d)||d.sens==='forfait'?'loyerHausse':'loyer'}
// Données tolérantes : les anciens appels (loyerPaye/datePaye, sans première indexation) restent valides.
function normaliser(d){if(!d.premiereIndex)d.premiereIndex=addYears(d.dateEffet,d.periode);if(!d.compMode)d.compMode='meme';
if(!d.paliers||!d.paliers.length)d.paliers=[{date:d.datePaye||d.dateEffet,montant:d.loyerPaye}];
d.paliers=d.paliers.slice().sort((a,b)=>a.date-b.date);d.datePaye=d.paliers[0].date;d.loyerPaye=d.paliers[d.paliers.length-1].montant;return d}

// Variation annuelle entre le trimestre i-4 et le trimestre i, après bouclier PME et clause tunnel.
function ratioAnnuel(d,i){const a=idx(d.indice,i-4),b=idx(d.indice,i);if(a==null||b==null)return null;
let r=b/a,brut=r,flags=[];
if(d.indice==='ILC'&&d.pme&&i>=BOUCLIER.debut&&i<=BOUCLIER.fin&&r>1+BOUCLIER.taux){r=1+BOUCLIER.taux;flags.push('bouclier')}
if(d.sens==='tunnel'&&d.tunnel>0){const t=d.tunnel/100;if(r>1+t){r=1+t;flags.push('tunnel')}else if(r<1-t){r=1-t;flags.push('tunnel')}}
return{r,brut,flags}}
// Variation entre deux trimestres quelconques : par pas annuels quand c'est possible, sinon au prorata.
function ratioEntre(d,a,b){const q=b-a;if(q<=0)return null;
if(q%4===0){let r=1,brut=1,flags=[];for(let j=a+4;j<=b;j+=4){const ra=ratioAnnuel(d,j);if(!ra)return null;r*=ra.r;brut*=ra.brut;flags=flags.concat(ra.flags)}return{r,brut,flags:[...new Set(flags)]}}
const ia=idx(d.indice,a),ib=idx(d.indice,b);if(ia==null||ib==null)return null;let r=ib/ia;const brut=r,flags=[];
if(d.indice==='ILC'&&d.pme&&b>=BOUCLIER.debut&&b<=BOUCLIER.fin){const cap=Math.pow(1+BOUCLIER.taux,q/4);if(r>cap){r=cap;flags.push('bouclier')}}
if(d.sens==='tunnel'&&d.tunnel>0){const h=Math.pow(1+d.tunnel/100,q/4),l=Math.pow(1-d.tunnel/100,q/4);if(r>h){r=h;flags.push('tunnel')}else if(r<l){r=l;flags.push('tunnel')}}
return{r,brut,flags}}

function indexations(d){normaliser(d);const ev=[];let loyer=d.loyerRef,loyerHausse=d.loyerRef,prevComp=d.refQ,prevDate=d.dateEffet,pending=null;
// Hausse forfaitaire réputée non écrite : le loyer dû reste le loyer de référence, loyerHausse garde la clause telle qu'appliquée.
if(d.sens==='forfait'){for(let k=0;k<200;k++){const date=addYears(d.premiereIndex,k);if(date>d.dateCalc)break;
ev.push({date,comp:null,prevComp:null,valeur:null,variation:0,loyer:d.loyerRef,loyerHausse:r2(d.loyerRef*Math.pow(1+d.forfait/100,k+1)),flags:['forfait'],distorsion:false})}return{ev,pending}}
for(let k=0;k<200;k++){const date=addYears(d.premiereIndex,k*d.periode);if(date>d.dateCalc)break;
const comp=d.compMode==='dernier'?dernierIndicePublie(d.indice,date):prevComp+4*d.periode;
if(comp==null||comp<=prevComp||idx(d.indice,comp)==null){pending={date,comp:comp==null||comp<=prevComp?prevComp+4*d.periode:comp};break}
const ra=ratioEntre(d,prevComp,comp);if(!ra){pending={date,comp};break}
const moisIdx=(comp-prevComp)*3,moisRev=moisEntre(prevDate,date),distorsion=moisIdx>moisRev+0.5;
const prec=loyer,ratio=ra.r,variation=ratio-1;loyer=r2(prec*ratio);
// Chaque indexation part du loyer précédent arrondi au centime : le calcul se refait à la main.
if(d.sens==='hausse')loyerHausse=r2(Math.max(loyerHausse,loyerHausse*ratio));else if(d.sens==='plancher')loyerHausse=Math.max(d.loyerRef,loyer);else loyerHausse=loyer;
ev.push({date,comp,prevComp,valeur:idx(d.indice,comp),variation,ratio,brut:ra.brut,prec,loyer,loyerHausse,flags:ra.flags,distorsion,moisIdx,moisRev});
prevComp=comp;prevDate=date}
return{ev,pending}}

function loyerEnVigueur(d,ev,t,champ){let l=d.loyerRef;for(const e of ev){if(e.date<=t)l=e[champ]||e.loyer;else break}return l}
// Loyer annuel réellement payé à la date t : les paliers saisis, et avant le premier, la clause telle qu'appliquée.
function payeA(d,ev,t){const p=d.paliers;if(t>=p[0].date){let m=p[0].montant;for(const x of p){if(x.date<=t)m=x.montant;else break}return m}return loyerEnVigueur(d,ev,t,champPaye(d))}

// Échéances à terme à échoir : le 1er de chaque mois ou de chaque trimestre civil.
function echeances(d){const out=[];let e=new Date(Date.UTC(d.dateEffet.getUTCFullYear(),d.dateEffet.getUTCMonth(),1));
if(d.terme===3)e=new Date(Date.UTC(e.getUTCFullYear(),Math.floor(e.getUTCMonth()/3)*3,1));
while(e<=d.dateCalc){const fin=addMonths(e,d.terme);if(fin>d.dateEffet)out.push({debut:e<d.dateEffet?d.dateEffet:e,exig:e,fin});e=fin}return out}

// Une échéance vaut loyer annuel × terme / 12, au prorata des jours si le loyer change en cours de période.
function integre(d,p,fn,dates,jusqua){const fin=jusqua||p.fin,jours=days(p.exig,p.fin);let total=0,t=p.debut;
const bornes=dates.filter(x=>x>p.debut&&x<fin).sort((a,b)=>a-b);bornes.push(fin);
for(const b of bornes){if(b>t){total+=fn(t)*d.terme/12*days(t,b)/jours;t=b}}return total}
function montantPeriode(d,ev,p,champ,jusqua){return integre(d,p,t=>loyerEnVigueur(d,ev,t,champ),ev.map(e=>e.date),jusqua)}
function partPeriode(d,p,debut){return d.terme/12*days(debut>p.debut?debut:p.debut,p.fin)/days(p.exig,p.fin)}

// Intérêts au taux légal, simples, échéance par échéance : à compter de la mise en demeure, ou de
// l'échéance elle-même quand elle lui est postérieure, jusqu'à la date du calcul.
function tauxLegal(t,pp){let r=null;for(const x of TAUX_LEGAL){if(parseDate(x.debut)<=t)r=x}return r?(pp?r.pp:r.autres)/100:null}
function interets(d,detail){if(!d.dateMED||d.dateMED>=d.dateCalc)return null;
const t0=parseDate(TAUX_LEGAL[0].debut),depuis=d.dateMED<t0?t0:d.dateMED;let total=0,assiette=0;const tranches={};
for(const p of detail){const m=p.du-p.paye;if(p.prescrit||m<=0.005)continue;
let from=p.exig>depuis?p.exig:depuis;if(from>=d.dateCalc)continue;assiette+=m;
while(from<d.dateCalc){const taux=tauxLegal(from,d.bailleurPhysique);const suiv=TAUX_LEGAL.map(x=>parseDate(x.debut)).find(x=>x>from);
const to=suiv&&suiv<d.dateCalc?suiv:d.dateCalc,j=days(from,to),i=m*taux*j/365;total+=i;
const k=String(taux);tranches[k]=tranches[k]||{taux,montant:0};tranches[k].montant+=i;from=to}}
if(!(total>0))return null;
return{total:r2(total),assiette:r2(assiette),depuis,tranches:Object.values(tranches),tronque:d.dateMED<t0}}

function calculer(d){normaliser(d);const{ev,pending}=indexations(d);const limite=addYears(d.dateCalc,-PRESCRIPTION_ANS);
const dates=ev.map(e=>e.date).concat(d.paliers.map(x=>x.date));
const lignes={},periodes=echeances(d),detail=[];let exigible=0,prescrit=0,restitTotale=0;
for(const p of periodes){
  let du=integre(d,p,t=>loyerEnVigueur(d,ev,t,'loyer'),dates);
  const paye=integre(d,p,t=>payeA(d,ev,t),dates);
  // Clause sur demande : pas de rappel avant la demande du bailleur.
  if(d.jeu==='demande'&&p.debut>=d.datePaye&&(!d.dateDemande||p.exig<d.dateDemande))du=paye;
  const ecart=du-paye,estPrescrit=p.exig<limite;
  detail.push({exig:p.exig,fin:p.fin,du,paye,prescrit:estPrescrit});
  const cle=p.exig.getUTCFullYear()+(estPrescrit?'p':'e');
  if(!lignes[cle])lignes[cle]={annee:p.exig.getUTCFullYear(),prescrit:estPrescrit,du:0,paye:0,ecart:0};
  lignes[cle].du+=du;lignes[cle].paye+=paye;lignes[cle].ecart+=ecart;
  if(estPrescrit)prescrit+=ecart;else exigible+=ecart;
  if(!estPrescrit)restitTotale+=Math.max(0,paye-d.loyerRef*partPeriode(d,p,p.debut))}
const annees=Object.values(lignes).filter(l=>Math.abs(l.ecart)>0.5||l.annee>=d.datePaye.getUTCFullYear()).sort((a,b)=>a.annee-b.annee||(a.prescrit?-1:1));
const loyerDu=loyerEnVigueur(d,ev,d.dateCalc,'loyer');
const variationTotale=loyerDu/d.loyerRef-1;
let quart=null;for(const e of ev){if(Math.abs(e.loyer/d.loyerRef-1)>0.25){quart=e;break}}
const distorsion=ev.find(e=>e.distorsion)||null;
const depot=d.depot>0&&d.depotIndexe?{verse:d.depot,du:r2(d.depot*loyerDu/d.loyerRef),complement:r2(d.depot*loyerDu/d.loyerRef-d.depot)}:null;
const R={ev,pending,annees,detail,exigible:r2(exigible),prescrit:r2(prescrit),restitTotale:r2(restitTotale),loyerDu,variationTotale,quart,limite,distorsion,depot};
R.interets=interets(d,R.detail);return R}


// ---------- Chronologie (légal design) ----------
const NB='\u00a0';
// Regroupe les échéances consécutives identiques : « 12 échéances × 8,60 € ».
function segments(R){const out=[];for(const x of R.detail){const l=out[out.length-1];
if(l&&Math.abs(l.du-x.du)<0.005&&Math.abs(l.paye-x.paye)<0.005&&l.prescrit===x.prescrit){l.n++;l.fin=x.fin}
else out.push({debut:x.exig,fin:x.fin,n:1,du:x.du,paye:x.paye,prescrit:x.prescrit})}
return out.filter(g=>Math.abs(g.du-g.paye)>=0.005)}
function nb(v,ind){return fr(v,ind==='ICC'?0:2)}
function payeAu(d,R,t){return payeA(d,R.ev,t)}
function chronologie(d,R,o){o=o||{};const items=[],I0=idx(d.indice,d.refQ);
items.push({t:d.dateEffet,k:0,cls:'start',titre:'Point de départ',lignes:['Loyer fixé'+NB+': '+euro(d.loyerRef,true)+' HT par an.',d.sens==='forfait'?'Le bail prévoit une hausse fixe de '+String(d.forfait).replace('.',',')+NB+'% par an.':'Indice de base'+NB+': '+d.indice+' du '+qLabel(d.refQ)+', soit '+nb(I0,d.indice)+'.']});
let prec=d.loyerRef;
R.ev.forEach((e,n)=>{const l=[];let calc;
  if(d.sens==='forfait'){calc='La clause porterait le loyer à '+euro(e.loyerHausse,true)+'. Elle est réputée non écrite'+NB+': le loyer dû reste '+euro(e.loyer,true)+'.';prec=e.loyerHausse}
  else{const brut=e.brut-1;
    const Ip=idx(d.indice,e.prevComp);
    calc=euro(e.prec,true)+(e.flags.length?' × '+String(+e.ratio.toFixed(5)).replace('.',','):' × '+nb(e.valeur,d.indice)+' ÷ '+nb(Ip,d.indice))+' = '+euro(e.loyer,true);
    l.push(d.indice+' du '+qLabel(e.comp)+NB+': '+nb(e.valeur,d.indice)+', contre '+nb(idx(d.indice,e.prevComp),d.indice)+' au '+qLabel(e.prevComp)+', soit '+pct(brut)+'.');
    if(e.distorsion)l.push('Distorsion'+NB+': '+Math.round(e.moisIdx)+' mois d\'indice pour '+Math.round(e.moisRev)+' mois de loyer.');
    if(e.flags.includes('bouclier'))l.push('Hausse réelle '+pct(brut)+', ramenée à +3,50'+NB+'% par le bouclier PME.');
    if(e.flags.includes('tunnel'))l.push('Variation ramenée à '+pct(e.variation)+' par la clause tunnel.');
    prec=e.loyer}
  const pa=payeAu(d,R,e.date),ec=e.loyer-pa;
  l.push('Loyer dû '+euro(e.loyer,true)+' · payé '+euro(pa,true)+(Math.abs(ec)>=0.005?' · écart '+(ec>0?'+':'−')+euro(Math.abs(ec),true)+' par an':' · aucun écart'));
  items.push({t:e.date,k:1,cls:'',titre:(d.sens==='forfait'?'Date anniversaire n°'+NB:'Indexation n°'+NB)+(n+1),calc,lignes:l})});
if(R.limite>d.dateEffet)items.push({t:R.limite,k:0,cls:'limit',titre:'Limite de prescription',lignes:['Cinq ans avant la date du calcul. Les échéances exigibles avant cette date ne peuvent plus être réclamées (article 2224 du code civil).']});
d.paliers.forEach(x=>{if(x.date>d.dateEffet)items.push({t:x.date,k:0,cls:'',titre:'Loyer payé',lignes:['Le loyer payé passe à '+euro(x.montant,true)+' HT par an.']})});
if(d.jeu==='demande'&&d.dateDemande)items.push({t:d.dateDemande,k:0,cls:'',titre:'Demande du bailleur',lignes:['La clause joue à compter de cette demande. Aucun rappel n\'est dû pour les échéances antérieures.']});
const terme=d.terme===1?'mensuelle':'trimestrielle';
segments(R).forEach(g=>items.push({t:g.debut,k:2,seg:g}));
items.sort((a,b)=>a.t-b.t||a.k-b.k);
const fin=R.exigible>=0?'Rattrapage exigible'+NB+': '+euro(R.exigible,true)+' HT.':'Trop-perçu à restituer au preneur'+NB+': '+euro(-R.exigible,true)+' HT.';
let h='<ol class="chrono">';
for(const it of items){if(it.seg){const g=it.seg,tot=(g.du-g.paye)*g.n,sg=v=>(v>0?'+':'−')+euro(Math.abs(v),true);
  const dueA=loyerEnVigueur(d,R.ev,g.debut,'loyer'),paidA=payeAu(d,R,g.debut),mois=g.n*d.terme;
  const plein=Math.abs(g.du-dueA*d.terme/12)<0.005&&Math.abs(g.paye-paidA*d.terme/12)<0.005;
  const op=plein?mois+' mois d\'écart à '+sg(dueA-paidA)+' par an = '+sg(tot):'Échéance au prorata des jours = '+sg(tot);
  h+='<li class="c-seg'+(g.prescrit?' old':'')+'"><span>Du '+fmtLong(g.debut)+' au '+fmtLong(new Date(g.fin-86400000))+(plein?' · '+g.n+' échéance'+(g.n>1?'s':'')+' '+terme+(g.n>1?'s':''):'')+'</span><span class="c-op">'+op+'</span><span class="pill '+(g.prescrit?'pill-old">Prescrit':'pill-ok">Exigible')+'</span></li>';continue}
  const old=it.t<R.limite&&it.cls!=='limit'&&it.cls!=='start';
  h+='<li class="c-node '+it.cls+(old?' old':'')+'"><p class="c-date">'+fmtLong(it.t)+'</p><p class="c-title">'+it.titre+'</p>'+(it.calc?'<p class="c-calc">'+it.calc+'</p>':'')+it.lignes.map(x=>'<p class="c-line">'+x+'</p>').join('')+'</li>'}
h+='<li class="c-node end"><p class="c-date">'+fmtLong(d.dateCalc)+'</p><p class="c-title">'+(o.titreFin||'Date du calcul')+'</p><p class="c-calc">'+fin+(R.prescrit>0.5?' Prescrit'+NB+': '+euro(R.prescrit,true)+'.':'')+'</p><p class="c-line">Loyer à appliquer désormais'+NB+': '+euro(R.loyerDu,true)+' HT par an. La prescription efface les échéances anciennes, pas le calcul'+NB+': ce loyer intègre toutes les indexations depuis l\'origine.</p><p class="c-line">Les totaux sont calculés sans arrondi intermédiaire. Un écart d\'un centime avec l\'addition des lignes est possible.</p></li></ol>';
return h}

// Frise courte : une ligne par date, l'écart annuel, la coupure de prescription, le total.
function friseCourte(d,R,o){o=o||{};const I0=idx(d.indice,d.refQ),rows=[];
rows.push({t:d.dateEffet,cls:'',main:'Loyer de départ'+NB+': '+euro(d.loyerRef,true),side:d.sens==='forfait'?'':d.indice+' '+nb(I0,d.indice)});
R.ev.forEach(e=>{const ec=e.loyer-payeAu(d,R,e.date),tags=[];
  if(e.flags.includes('bouclier'))tags.push(tip('Bouclier 3,5'+NB+'%','bouclier'));
  if(e.flags.includes('tunnel'))tags.push('Tunnel');
  if(e.flags.includes('forfait'))tags.push('Hausse écartée');
  else if(e.variation<0)tags.push('Baisse');
  rows.push({t:e.date,cls:e.date<R.limite?'old':'',main:'Loyer dû'+NB+': '+euro(e.loyer,true),side:(Math.abs(ec)<0.005?'aucun écart':(ec>0?'non payé ':'payé en trop ')+euro(Math.abs(ec),true)+' par an'),tags})});
if(R.limite>d.dateEffet)rows.push({t:R.limite,cls:'cut',main:'Limite de '+tip('prescription','prescription'),side:'Échéances antérieures perdues, loyer indexé acquis'});
rows.sort((a,b)=>a.t-b.t);
let h='<ol class="frise">'+rows.map(r=>'<li class="f-row '+r.cls+'"><span class="f-date">'+fmtLong(r.t)+'</span><span class="f-main">'+r.main+(r.tags||[]).map(x=>' <span class="pill pill-cap">'+x+'</span>').join('')+'</span><span class="f-side">'+r.side+'</span></li>').join('');
const tot=R.exigible>=0?'Rattrapage exigible'+NB+': '+euro(R.exigible,true):'Trop-perçu à restituer'+NB+': '+euro(-R.exigible,true);
h+='<li class="f-row end"><span class="f-date">'+fmtLong(d.dateCalc)+'</span><span class="f-main">'+tot+'</span><span class="f-side">'+(o.fin||'Date du calcul')+(R.prescrit>0.5?' · '+euro(R.prescrit,true)+' prescrits':'')+'</span></li></ol>';
return h}
function calculsTypes(d,R){const I0=idx(d.indice,d.refQ),e1=R.ev[0],eb=R.ev.find(e=>e.flags.includes('bouclier')),g=segments(R).find(x=>x.prescrit===false);
const c=[];
if(e1)c.push({t:'La formule',v:euro(d.loyerRef,true)+' × '+nb(e1.valeur,d.indice)+' ÷ '+nb(I0,d.indice)+' = '+euro(e1.loyer,true),n:'Loyer × nouvel indice ÷ indice de base. Chaque année repart du loyer précédent.'});
if(eb){const brut=eb.brut-1;c.push({t:tip('Le bouclier PME','bouclier'),v:euro(eb.prec,true)+' × 1,035 = '+euro(eb.loyer,true),n:'En '+eb.date.getUTCFullYear()+', l\'ILC monte de '+pct(brut)+'. La hausse est ramenée à 3,5'+NB+'%, définitivement.'})}
if(R.limite>d.dateEffet&&g){const dueA=loyerEnVigueur(d,R.ev,g.debut,'loyer'),paidA=payeAu(d,R,g.debut),plein=Math.abs(g.du-dueA*d.terme/12)<0.005&&Math.abs(g.paye-paidA*d.terme/12)<0.005;
  c.push({t:tip('La prescription','prescription'),v:plein?euro(dueA-paidA,true)+' × '+(g.n*d.terme)+'/12 = '+euro((g.du-g.paye)*g.n,true):euro((g.du-g.paye)*g.n,true)+' sur '+g.n+' échéance'+(g.n>1?'s':'')+', au prorata des jours',n:'Seuls comptent les mois postérieurs au '+fmtLong(R.limite)+'. Les mois antérieurs sont prescrits.'})}
return '<div class="calc-types">'+c.map(x=>'<div class="ct"><p class="ct-t">'+x.t+'</p><p class="ct-v">'+x.v+'</p><p class="ct-n">'+x.n+'</p></div>').join('')+'</div>'}
const EXEMPLE={ca:320000,charges:0,indice:'ILC',periode:1,sens:'symetrique',tunnel:0,forfait:0,jeu:'auto',dateDemande:null,pme:true,terme:1,
dateEffet:parseDate('2020-07-01'),loyerRef:24000,refQ:qi(2020,1),loyerPaye:24000,datePaye:parseDate('2020-07-01'),dateCalc:parseDate('2026-09-28')};
function effortExemple(d,R){const L=tauxEffort(d,R),A=ampleur(d,R);
return '<div class="ex-effort"><p class="ct-t">'+tip('Taux d\'effort','effort')+' · loyer annuel HT ÷ CA HT de '+euro(d.ca)+'</p><div class="ef-mini">'+L.slice(0,3).map(x=>'<div><span class="ef-m-lib">'+x.lib+'</span><span class="ef-m-v">'+fr(x.v*100,1)+NB+'%</span><span class="ef-m-c">'+x.detail+'</span></div>').join('')+'</div>'+ampleurHTML(A)+'</div>'}
function renderExemple(){const el=document.getElementById('chrono-exemple');if(!el||!window.INDICES)return;
try{const R=calculer(EXEMPLE);el.innerHTML=friseCourte(EXEMPLE,R,{fin:'Le bailleur réclame'})+calculsTypes(EXEMPLE,R)+effortExemple(EXEMPLE,R)}catch(e){}}


// ---------- Glossaire et infobulles ----------
const GLOSSAIRE={
ilc:'Indice des loyers commerciaux, publié chaque trimestre par l\'INSEE. C\'est l\'indice de référence du commerce, de l\'artisanat et de la restauration.',
ilat:'Indice des loyers des activités tertiaires, publié chaque trimestre par l\'INSEE. Il vise les bureaux et les professions libérales.',
icc:'Indice du coût de la construction, publié par l\'INSEE. Plus volatil que l\'ILC, il figure surtout dans les baux anciens.',
base:'Le chiffre de départ du calcul. Le loyer évolue ensuite exactement comme l\'indice depuis ce trimestre.',
echelle:'Autre nom de la clause d\'indexation. Le loyer suit automatiquement un indice, à la hausse comme à la baisse.',
rne:'La clause est traitée comme si elle n\'avait jamais existé. Le reste du bail continue de s\'appliquer.',
tunnel:'Clause qui limite la variation annuelle du loyer à un même pourcentage, à la hausse comme à la baisse.',
pme:'Entreprise de moins de 250 salariés, avec moins de 50 M€ de chiffre d\'affaires ou 43 M€ de total de bilan.',
bouclier:'Plafond légal : pour une PME, la hausse annuelle de l\'ILC est limitée à 3,5 % du 2e trimestre 2022 au 1er trimestre 2024. L\'excédent ne se rattrape jamais.',
echeance:'Date à laquelle le loyer doit être payé : chaque mois ou chaque trimestre, le plus souvent d\'avance.',
prescription:'Délai au-delà duquel une somme ne peut plus être réclamée. Pour un loyer, cinq ans à compter de chaque échéance.',
rattrapage:'Les loyers indexés que le preneur n\'a pas payés et que le bailleur réclame pour le passé, dans la limite de cinq ans.',
vl:'Le loyer de marché du local. Il dépend de ses caractéristiques, de la destination, des obligations des parties, des facteurs locaux de commercialité et des prix du voisinage (article L. 145-33 du code de commerce).',
flc:'Ce qui attire la clientèle autour du local : passage, transports, commerces voisins, équipements du quartier.',
distorsion:'Une clause compare deux indices séparés par plus de temps qu\'il ne s\'en écoule entre deux indexations, par exemple 15 mois d\'indice pour 12 mois de loyer. Elle est réputée non écrite (article L. 112-1 du code monétaire et financier).',
plancher:'Clause qui laisse le loyer baisser, mais jamais sous le loyer de départ. Elle écarte une partie des baisses : la Cour de cassation la traite comme la clause à la hausse seule (Cass. civ. 3e, 25 janvier 2023, n° 20-20.514).',
effort:'Loyer annuel HT divisé par le chiffre d\'affaires HT : la part des recettes absorbée par le loyer. Repères du cabinet en restauration : moins de 7 % confortable, 7 à 8 % normal, 8 à 9 % élevé, au-delà de 9 % tendu.'};
function tip(term,key){return '<span class="tip" tabindex="0" data-g="'+key+'">'+term+'</span>'}
function initBulles(){const root=document.getElementById('simu-index');if(!root)return;
const b=document.createElement('div');b.id='si-bulle';b.setAttribute('role','tooltip');b.hidden=true;document.body.appendChild(b);let cible=null;
const texte=el=>el.dataset.tipx||GLOSSAIRE[el.dataset.g]||'';
function montrer(el){const t=texte(el);if(!t)return;cible=el;b.textContent=t;b.hidden=false;el.setAttribute('aria-describedby','si-bulle');
  const r=el.getBoundingClientRect(),w=b.offsetWidth,h=b.offsetHeight,vw=document.documentElement.clientWidth;
  let x=Math.min(Math.max(8,r.left+r.width/2-w/2),vw-w-8),y=r.top-h-10;if(y<8)y=r.bottom+10;
  b.style.left=x+'px';b.style.top=y+'px'}
function cacher(){if(cible)cible.removeAttribute('aria-describedby');cible=null;b.hidden=true}
const trouver=e=>e.target.closest&&e.target.closest('#simu-index [data-g],#simu-index [data-tipx]');
root.addEventListener('mouseover',e=>{const el=trouver(e);if(el&&el!==cible)montrer(el)});
root.addEventListener('mouseout',e=>{const el=trouver(e);if(el&&!el.contains(e.relatedTarget))cacher()});
root.addEventListener('focusin',e=>{const el=trouver(e);if(el)montrer(el)});
root.addEventListener('focusout',cacher);
root.addEventListener('click',e=>{const el=trouver(e);if(el&&el.classList.contains('tip')){e.preventDefault();cible===el?cacher():montrer(el)}});
document.addEventListener('keydown',e=>{if(e.key==='Escape')cacher()});
window.addEventListener('scroll',()=>{if(cible)montrer(cible)},{passive:true})}

// ---------- Taux d'effort ----------
const SEUILS_EFFORT=[{max:0.07,lib:'Confortable',cls:'ok'},{max:0.08,lib:'Normal',cls:'info'},{max:0.09,lib:'Élevé',cls:'warn'},{max:Infinity,lib:'Tendu',cls:'bad'}];
function niveau(x){return SEUILS_EFFORT.find(s=>x<s.max)}
function tauxEffort(d,R){if(!(d.ca>0))return null;const ch=d.charges||0,ratt=Math.max(R.exigible,0),L=[];
L.push({k:'avant',lib:'Aujourd\'hui',sub:'loyer annuel HT payé',v:(d.loyerPaye+ch)/d.ca,detail:euro(d.loyerPaye,true)+(ch?' + '+euro(ch,true)+' de charges':'')+' ÷ '+euro(d.ca)+' de CA HT'});
L.push({k:'apres',lib:'Après indexation',sub:'loyer annuel HT dû',v:(R.loyerDu+ch)/d.ca,detail:euro(R.loyerDu,true)+(ch?' + '+euro(ch,true)+' de charges':'')+' ÷ '+euro(d.ca)+' de CA HT'});
if(ratt>0.5){L.push({k:'annee',lib:'L\'année du rattrapage',sub:'payé en une fois',v:(R.loyerDu+ch+ratt)/d.ca,detail:euro(R.loyerDu,true)+' + '+euro(ratt,true)+' de rattrapage'+(ch?' + charges':'')+' ÷ '+euro(d.ca)+' de CA HT'});
  L.push({k:'etale',lib:'Étalé sur 24 mois',sub:'rattrapage divisé par deux ans',v:(R.loyerDu+ch+ratt/2)/d.ca,detail:euro(R.loyerDu,true)+' + '+euro(ratt/2,true)+' par an'+(ch?' + charges':'')+' ÷ '+euro(d.ca)+' de CA HT'})}
return L}
function renderEffort(d,R){const bloc=document.getElementById('bloc-effort'),L=tauxEffort(d,R);if(!L){bloc.hidden=true;return}bloc.hidden=false;
const echelle=Math.max(0.12,Math.ceil(Math.max(...L.map(x=>x.v))*100/2)*2/100);
const pos=v=>(v/echelle*100).toFixed(2)+'%';
let h='<div class="ef-scale" aria-hidden="true"><span></span><span class="ef-track">'+[0.07,0.09].map(t=>'<i style="left:'+pos(t)+'">'+fr(t*100,0)+NB+'%</i>').join('')+'</span><span></span></div>';
h+=L.map(x=>{const n=niveau(x.v);return '<div class="ef-row" data-tipx="'+x.detail.replace(/"/g,'&quot;')+' = '+fr(x.v*100,1)+' %"><span class="ef-lib"><strong>'+x.lib+'</strong><span>'+x.sub+'</span></span><span class="ef-track">'+[0.07,0.08,0.09].map(t=>'<i class="ef-tick" style="left:'+pos(t)+'"></i>').join('')+'<b class="ef-bar ef-'+x.k+'" style="width:'+pos(x.v)+'"></b></span><span class="ef-val">'+fr(x.v*100,1)+NB+'%<span class="pill st-'+n.cls+'">'+n.lib+'</span></span></div>'}).join('');
document.getElementById('effort').innerHTML=h;
const av=L[0].v,ap=L[1].v;
document.getElementById('effort-note').textContent='Le taux d\'effort passe de '+fr(av*100,1)+' % à '+fr(ap*100,1)+' % du chiffre d\'affaires'+(L[2]?', et monte à '+fr(L[2].v*100,1)+' % l\'année où le rattrapage est payé en une fois':'')+'. Repères du cabinet en restauration : moins de 7 % confortable, 7 à 8 % normal, 8 à 9 % élevé, au-delà de 9 % tendu. Survolez ou touchez une barre pour voir le calcul.'}


// Ampleur de la hausse : repères du cabinet, pas une norme légale.
const NIVEAUX=[{lib:'Hausse modérée',cls:'ok'},{lib:'Hausse sensible',cls:'info'},{lib:'Forte augmentation',cls:'warn'},{lib:'Très forte augmentation',cls:'bad'}];
function ampleur(d,R){const h=R.loyerDu/d.loyerPaye-1,ratt=Math.max(R.exigible,0),mois=ratt/(R.loyerDu/12);
if(h<=0.0005&&ratt<0.5)return null;
const nh=h<0.05?0:h<0.10?1:h<0.25?2:3,nm=mois<1?0:mois<3?1:mois<6?2:3,n=Math.max(nh,nm),L=tauxEffort(d,R),ph=[];
ph.push('Le loyer annuel HT passe de '+euro(d.loyerPaye,true)+' à '+euro(R.loyerDu,true)+', soit '+pct(h)+'.');
if(ratt>0.5)ph.push('Le rattrapage de '+euro(ratt,true)+' représente '+fr(mois,1)+' mois du nouveau loyer.');
if(L){const pts=(L[1].v-L[0].v)*100;ph.push('Le taux d\'effort passe de '+fr(L[0].v*100,1)+NB+'% à '+fr(L[1].v*100,1)+NB+'% du CA HT ('+(pts>=0?'+':'−')+fr(Math.abs(pts),1)+' point'+(Math.abs(pts)>=2?'s':'')+')'+(L[2]?', et atteint '+fr(L[2].v*100,1)+NB+'% l\'année où le rattrapage est payé en une fois.':'.'))}
if(h>=0.25)ph.push('Au-delà de 25 %, chaque partie peut demander la révision du loyer à la valeur locative (article L. 145-39 du code de commerce).');
if(n>=2)ph.push(hausseSeule(d)||d.sens==='forfait'||R.distorsion?'Vérifiez d\'abord la validité de la clause : elle peut réduire ou annuler la somme.':'Un échéancier négocié avant tout commandement de payer est la priorité.');
return{n,niv:NIVEAUX[n],ph,h,mois}}
function ampleurHTML(A){if(!A)return'';return '<div class="verdict v-'+A.niv.cls+'"><p class="v-titre"><span class="pill st-'+A.niv.cls+'">'+A.niv.lib+'</span></p>'+A.ph.map(x=>'<p>'+x+'</p>').join('')+'<p class="v-note">Repères du cabinet'+NB+': hausse du loyer de moins de 5'+NB+'% modérée, de 5 à 10'+NB+'% sensible, de 10 à 25'+NB+'% forte, au-delà très forte. Un rattrapage de plus de trois mois de loyer compte comme forte augmentation, au-delà de six mois comme très forte.</p></div>'}


// ---------- Lecture automatique du bail ----------
const LECTURE_ENDPOINT='https://tcnzmfcmihwzoaaffgfz.supabase.co/functions/v1/lecture-bail';
// Clé publique Supabase (rôle anon), faite pour être exposée côté navigateur : la fonction vérifie ce jeton.
const SUPABASE_ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjbnptZmNtaWh3em9hYWZmZ2Z6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1NDM4ODEsImV4cCI6MjA5MTExOTg4MX0.n_FqRrWFP7Y7hlfDUBkiBNHB_vE7L19IlRKB5tHw2JI';
const LECTURE_MAX_FICHIERS=3,LECTURE_MAX_OCTETS=10*1024*1024;
let bailLu=false,bailDossier=null;
function initDepot(){const inp=document.getElementById('bail_fichiers'),ok=document.getElementById('bail_consent'),btn=document.getElementById('btn-lire');if(!inp)return;
const maj=()=>{const f=[...inp.files];document.getElementById('depot-noms').textContent=f.length?f.map(x=>x.name).join(', '):'Aucun fichier choisi · 3 fichiers et 10'+NB+'Mo au plus';btn.disabled=!(f.length&&ok.checked)};
inp.addEventListener('change',maj);ok.addEventListener('change',maj)}
function lireFichier(f){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]);r.onerror=()=>rej(r.error);r.readAsDataURL(f)})}
function etatDepot(m,cls){const e=document.getElementById('depot-etat');e.textContent=m;e.className='depot-etat'+(cls?' '+cls:'')}
async function lireBail(){const inp=document.getElementById('bail_fichiers'),btn=document.getElementById('btn-lire'),f=[...inp.files];
if(!document.getElementById('bail_consent').checked)return etatDepot('Cochez la case de consentement pour lancer la lecture.','err');
if(!f.length||f.length>LECTURE_MAX_FICHIERS)return etatDepot('Déposez entre 1 et 3 fichiers.','err');
if(f.some(x=>!['application/pdf','image/jpeg','image/png','image/webp'].includes(x.type)))return etatDepot('Formats acceptés'+NB+': PDF, JPEG, PNG ou WebP.','err');
if(f.reduce((a,x)=>a+x.size,0)>LECTURE_MAX_OCTETS)return etatDepot('Fichiers trop lourds'+NB+': 10'+NB+'Mo au total au maximum. Déposez le bail sans ses annexes.','err');
btn.disabled=true;etatDepot('Lecture en cours. Cela prend en général 20 à 60 secondes.','wait');
try{const fichiers=await Promise.all(f.map(async x=>({type:x.type,nom:x.name,data:await lireFichier(x)})));
  const garde=document.getElementById('bail_conserver'),conserver=!!(garde&&garde.checked);
  const r=await fetch(LECTURE_ENDPOINT,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+SUPABASE_ANON,apikey:SUPABASE_ANON},body:JSON.stringify({fichiers,consentement:true,conserver,conservation_texte:conserver?garde.closest('label').textContent.trim():''})});
  const j=await r.json().catch(()=>({}));
  if(j.dossier)bailDossier=j.dossier;
  if(!r.ok||!j.donnees)throw new Error(j.erreur||'La lecture n\'a pas abouti. Remplissez les cases à la main.');
  appliquerLecture(j.donnees);bailLu=true;etatDepot('Lecture terminée. Vérifiez les réponses ci-dessous, puis les cases pré-remplies.'+(bailDossier?' Votre bail a été transmis au cabinet.':''),'ok')}
catch(e){etatDepot(((e&&e.message&&!/fetch|network/i.test(e.message))?e.message:'La lecture automatique est indisponible pour le moment. Remplissez les cases à la main.')+(bailDossier?' Votre bail a bien été transmis au cabinet.':''),'err')}
finally{btn.disabled=false}}
function cocher(name,val){if(!/^[A-Za-z0-9_-]+$/.test(String(val)))return false;const el=document.querySelector('#simu-index input[name="'+name+'"][value="'+val+'"]');if(el){el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}))}return!!el}
function badge(id){const el=document.getElementById(id)||document.querySelector('#simu-index input[name="'+id+'"]');const g=el&&el.closest('.form-group');if(!g)return;const l=g.querySelector('label');if(l&&!l.querySelector('.badge-lu'))l.insertAdjacentHTML('beforeend',' <span class="badge-lu">Lu dans le bail</span>')}
function appliquerLecture(x){document.querySelectorAll('#simu-index .badge-lu').forEach(b=>b.remove());
const vu=c=>c&&c.confiance!=='absent'&&c.valeur!==''&&c.valeur!=='inconnu'&&c.valeur!==0;
if(vu(x.indice)&&cocher('indice',x.indice.valeur))badge('indice');
if(vu(x.date_effet)&&/^\d{4}-\d{2}-\d{2}$/.test(x.date_effet.valeur)){const el=document.getElementById('date_effet');el.value=x.date_effet.valeur;el.dispatchEvent(new Event('change',{bubbles:true}));badge('date_effet')}
if(vu(x.loyer_annuel_ht)&&typeof x.loyer_annuel_ht.valeur==='number'&&x.loyer_annuel_ht.valeur>0){document.getElementById('loyer_ref').value=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(x.loyer_annuel_ht.valeur);badge('loyer_ref')}
if(x.indice_base_mode&&x.indice_base_mode.valeur==='trimestre_fixe'&&vu(x.indice_base_trimestre)&&vu(x.indice_base_annee)&&[1,2,3,4].includes(x.indice_base_trimestre.valeur)&&Number.isInteger(x.indice_base_annee.valeur)&&x.indice_base_annee.valeur>=2008&&x.indice_base_annee.valeur<=new Date().getFullYear()){
  document.getElementById('ref_trim').value=String(x.indice_base_trimestre.valeur);document.getElementById('ref_annee').value=String(x.indice_base_annee.valeur);afficherRef();badge('ref_annee')}
else if(x.indice_base_mode&&x.indice_base_mode.valeur==='dernier_publie'){proposerRef();badge('ref_annee')}
if(vu(x.periodicite)&&cocher('periode',x.periodicite.valeur==='triennale'?'3':'1'))badge('periode');
if(vu(x.date_premiere_indexation)&&/^\d{4}-\d{2}-\d{2}$/.test(x.date_premiere_indexation.valeur)){const pi=document.getElementById('premiere_index');pi.value=x.date_premiere_indexation.valeur;delete pi.dataset.auto;badge('premiere_index')}else proposerPremiere();
if(vu(x.indice_comparaison)&&cocher('comp_mode',x.indice_comparaison.valeur==='dernier_publie'?'dernier':'meme'))badge('comp_mode');
if(vu(x.depot_garantie)&&typeof x.depot_garantie.valeur==='number'&&x.depot_garantie.valeur>0){document.getElementById('depot_garantie').value=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(x.depot_garantie.valeur);badge('depot_garantie');if(vu(x.depot_indexe))cocher('depot_indexe',x.depot_indexe.valeur==='oui'?'oui':'non')}
if(vu(x.sens)&&cocher('sens',x.sens.valeur)){badge('sens');if(vu(x.taux)&&typeof x.taux.valeur==='number'&&x.taux.valeur>0&&x.taux.valeur<50){document.getElementById(x.sens.valeur==='forfait'?'forfait_pct':'tunnel_pct').value=String(x.taux.valeur).replace('.',',')}}
if(vu(x.jeu)&&cocher('jeu',x.jeu.valeur))badge('jeu');
if(vu(x.echeances)&&cocher('terme',x.echeances.valeur==='trimestrielles'?'3':'1'))badge('terme');
sauver();afficherLu(x)}
const LIB_LU={date_effet:'Prise d\'effet du loyer',loyer_annuel_ht:'Loyer annuel HT',indice:'Indice',indice_base_mode:'Désignation de l\'indice de base',indice_base_trimestre:'Trimestre de base',indice_base_annee:'Année de base',periodicite:'Rythme d\'indexation',date_premiere_indexation:'Première indexation',indice_comparaison:'Indice de comparaison',sens:'Sens de la clause',taux:'Pourcentage prévu',jeu:'Jeu de la clause',echeances:'Échéances',depot_garantie:'Dépôt de garantie',depot_indexe:'Dépôt indexé comme le loyer'};
const VAL_LU={meme_trimestre:'le même trimestre, un an plus tard',oui:'oui',non:'non',plancher:'plancher (jamais sous le loyer de départ)',trimestre_fixe:'un trimestre précis',dernier_publie:'le dernier indice publié à la prise d\'effet',annuelle:'chaque année',triennale:'tous les trois ans',symetrique:'dans les deux sens',hausse:'à la hausse seulement',tunnel:'encadrée (tunnel)',forfait:'hausse fixe',auto:'automatique',demande:'sur demande du bailleur',mensuelles:'mensuelles',trimestrielles:'trimestrielles'};
function esc(t){return String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function afficherLu(x){const el=document.getElementById('lu');let h='<p class="lu-titre">Ce que nous avons lu dans votre bail</p>';
if(x.document_est_un_bail===false)h+='<div class="alert alert-danger"><strong>Document à vérifier</strong>Ce document ne semble pas être un bail commercial. Vérifiez le fichier ou remplissez les cases à la main.</div>';
h+='<ul class="lu-liste">'+Object.keys(LIB_LU).map(k=>{const c=x[k];if(!c)return'';
  if(k==='taux'&&!(c.valeur>0))return'';
  if((k==='indice_base_trimestre'||k==='indice_base_annee')&&x.indice_base_mode&&x.indice_base_mode.valeur==='dernier_publie')return'';
  const absent=c.confiance==='absent'||c.valeur===''||c.valeur==='inconnu'||c.valeur===0;
  let v=absent?'Non trouvé':(k==='date_effet'||k==='date_premiere_indexation')?fmtLong(parseDate(c.valeur)):(k==='loyer_annuel_ht'||k==='depot_garantie')?euro(c.valeur,true):k==='taux'?String(c.valeur).replace('.',',')+NB+'%':k==='indice_base_trimestre'?qLabel(qi(2000,c.valeur)).replace(' 2000',''):VAL_LU[c.valeur]||String(c.valeur);
  const pill=absent?'<span class="pill st-warn">À compléter</span>':c.confiance==='certain'?'<span class="pill st-ok">Lu dans le bail</span>':'<span class="pill st-info">Déduit, à vérifier</span>';
  return '<li><span class="lu-lib">'+LIB_LU[k]+'</span><span class="lu-val">'+esc(v)+' '+pill+'</span>'+(c.extrait?'<q class="lu-ext">'+esc(c.extrait)+'</q>'+(c.page?'<span class="lu-page">page '+c.page+'</span>':''):'')+'</li>'}).join('')+'</ul>';
if(x.avertissements&&x.avertissements.length)h+='<div class="alert alert-warning"><strong>Points signalés à la lecture</strong>'+x.avertissements.map(a=>'<span class="lu-av">'+esc(a)+'</span>').join('')+'</div>';
h+='<p class="note">La lecture automatique peut se tromper. Relisez chaque ligne et corrigez les cases si besoin. Le loyer payé aujourd\'hui et votre chiffre d\'affaires restent à saisir à l\'étape 3.</p>';
el.innerHTML=h;el.hidden=false}

// ---------- Contrôles juridiques ----------
function controles(d,R){const a=[];
if(hausseSeule(d))a.push({niv:'danger',t:d.sens==='plancher'?'Clause plancher':'Clause à la hausse seulement',m:(d.sens==='plancher'?'Une clause qui interdit au loyer de descendre sous le loyer de départ écarte une partie des baisses. Elle est réputée non écrite comme la clause à la hausse seule (Cass. civ. 3e, 25 janvier 2023, n° 20-20.514)':'Une clause qui écarte la baisse est réputée non écrite (Cass. civ. 3e, 12 janvier 2022, n° 21-11.169)')+'. En principe, seule la stipulation qui écarte la baisse tombe : le calcul ci-dessous applique l\'indice dans les deux sens. Si la clause était jugée indivisible, le loyer dû redeviendrait le loyer de référence'+(R.restitTotale>0.5?' et le preneur pourrait récupérer '+euro(R.restitTotale)+' sur les cinq dernières années':'')+' (Cass. civ. 3e, 23 janvier 2025, n° 23-18.643).'});
if(d.sensInconnu)a.push({niv:'warning',t:'Sens de la clause à vérifier',m:'Vous ne savez pas si la clause joue dans les deux sens. Le calcul applique l\'indice à la hausse comme à la baisse. Si votre bail interdit la baisse ou prévoit une hausse fixe, le résultat change, souvent en faveur du preneur : relisez la clause.'});
if(d.jeuInconnu)a.push({niv:'warning',t:'Jeu de la clause à vérifier',m:'Le calcul suppose une indexation automatique. Si la clause exige une demande du bailleur, aucun rappel n\'est dû avant cette demande.'});
if(R.distorsion)a.push({niv:'danger',t:'Distorsion entre l\'indice et la période',m:'À l\'indexation du '+fmtLong(R.distorsion.date)+', la clause compare '+Math.round(R.distorsion.moisIdx)+' mois d\'indice ('+qLabel(R.distorsion.prevComp)+' à '+qLabel(R.distorsion.comp)+') pour '+Math.round(R.distorsion.moisRev)+' mois de loyer. Une clause qui prend en compte une période de variation de l\'indice supérieure à la durée entre deux révisions est réputée non écrite (article L. 112-1 du code monétaire et financier). Le calcul applique la clause telle qu\'elle est rédigée. Si elle était écartée en entier, le loyer dû redeviendrait le loyer de référence'+(R.restitTotale>0.5?' et le preneur pourrait récupérer '+euro(R.restitTotale)+' sur les cinq dernières années':'')+' (Cass. civ. 3e, 23 janvier 2025, n° 23-18.643). L\'étendue du réputé non écrit dépend de la rédaction : faites-la vérifier.'});
if(R.depot&&R.depot.complement>0.5)a.push({niv:'info',t:'Dépôt de garantie indexé',m:'Le dépôt de '+euro(R.depot.verse,true)+' suit le loyer : il devrait atteindre '+euro(R.depot.du,true)+', soit un complément de '+euro(R.depot.complement,true)+' que le bailleur peut demander si le bail le prévoit.'});
if(d.depot>0&&d.dateEffet>=new Date(Date.UTC(2026,4,28))&&d.depot>R.loyerDu/4+0.5)a.push({niv:'warning',t:'Dépôt de garantie plafonné',m:'Pour un bail conclu ou renouvelé depuis le 28 mai 2026, le dépôt de garantie des locaux visés à l\'article L. 145-32-1 du code de commerce (commerce de détail ou de gros, prestations de services à caractère commercial ou artisanal) ne peut excéder un trimestre de loyer (article L. 145-40 du code de commerce). Le dépôt saisi dépasse '+euro(R.loyerDu/4,true)+'.'});
if(R.interets)a.push({niv:'info',t:'Intérêts de retard',m:'Chaque échéance impayée produit des intérêts au taux légal depuis la mise en demeure du '+fmtLong(R.interets.depuis)+', ou depuis son exigibilité si elle est postérieure ('+(d.bailleurPhysique?'créancier personne physique n\'agissant pas pour ses besoins professionnels':'taux applicable à tous les autres cas')+') : '+euro(R.interets.total,true)+' au '+fmtLong(d.dateCalc)+' sur une assiette de '+euro(R.interets.assiette,true)+', intérêts simples, sans capitalisation (article 1343-2 du code civil).'+(R.interets.tronque?' Les taux antérieurs à 2024 ne sont pas intégrés : le calcul part du 1er janvier 2024.':'')});
if(d.sens==='forfait')a.push({niv:'danger',t:'Hausse forfaitaire automatique',m:'Une clause qui augmente le loyer de '+String(d.forfait).replace('.',',')+' % par an, sans plafond ni limite de durée, organise une révision à la seule hausse. Elle est réputée non écrite (Cass. civ. 3e, 3 septembre 2026, n° 25-14.904, publié au Bulletin). Le loyer dû reste le loyer de référence. Le preneur peut récupérer les sommes versées en trop dans les cinq ans précédant sa demande en justice, calculées sur ce loyer (Cass. civ. 3e, 23 janvier 2025, n° 23-18.643). Vérifiez d\'abord qu\'il ne s\'agit pas d\'un loyer par paliers plafonné, fixé dès la signature, qui reste licite.'});
if(d.sens==='tunnel'&&d.indice!=='ILC')a.push({niv:'warning',t:'Tunnel sur un indice autre que l\'ILC',m:'L\'article L. 145-38-1 du code de commerce n\'autorise expressément que l\'encadrement de la variation de l\'ILC. Sur l\'ILAT ou l\'ICC, la validité de la clause reste à analyser.'});
else if(d.sens==='tunnel'&&d.dateEffet<new Date(Date.UTC(2026,4,28)))a.push({niv:'warning',t:'Clause tunnel antérieure au 28 mai 2026',m:'L\'article L. 145-38-1 du code de commerce, issu de la loi n° 2026-403 du 26 mai 2026, est en vigueur depuis le 28 mai 2026. La loi ne prévoit aucune disposition transitoire pour cet article : ses mesures d\'application aux baux en cours visent le paiement mensuel du loyer et le dépôt de garantie, pas la clause tunnel. Pour un bail conclu avant cette date, la validité de la clause s\'apprécie en principe selon le droit antérieur, qui ne la consacrait pas expressément. Le calcul applique la clause telle qu\'elle est rédigée.'});
if(R.ev.some(e=>e.flags.includes('bouclier')))a.push({niv:'ok',t:'Bouclier PME appliqué',m:'La variation annuelle de l\'ILC a été plafonnée à 3,5 % pour les trimestres du 2e trimestre 2022 au 1er trimestre 2024. Ce plafonnement est définitivement acquis (loi n° 2022-1158 du 16 août 2022, art. 14).'});
else if(d.indice==='ILC'&&!d.pme&&R.ev.some(e=>e.comp>=BOUCLIER.debut&&e.prevComp<=BOUCLIER.fin))a.push({niv:'warning',t:'Bouclier non appliqué',m:'Vous avez indiqué que le preneur n\'est pas une PME. Si c\'est le cas, la variation de l\'ILC entre le 2e trimestre 2022 et le 1er trimestre 2024 aurait dû être plafonnée à 3,5 % par an.'});
if(R.quart)a.push({niv:'warning',t:'Seuil du quart franchi',m:'Depuis l\'indexation du '+fmtLong(R.quart.date)+', le loyer a varié de plus de 25 % par rapport au loyer de référence ('+pct(R.quart.loyer/d.loyerRef-1)+'). Chaque partie peut demander la révision à la valeur locative, avec une hausse limitée à 10 % par an (article L. 145-39 du code de commerce).'});
if(d.jeu==='demande'&&!d.dateDemande)a.push({niv:'warning',t:'Aucune demande d\'indexation',m:'La clause subordonne l\'indexation à une demande du bailleur. Sans demande, aucun rappel n\'est calculé. Le loyer indexé s\'appliquera en principe à compter de la demande : '+euro(R.loyerDu,true)+' HT par an à ce jour.'});
if(R.pending)a.push({niv:'warning',t:'Indice pas encore publié',m:'L\'indexation du '+fmtLong(R.pending.date)+' suppose l\'indice du '+qLabel(R.pending.comp)+', qui n\'est pas encore paru. Elle sera calculable à sa publication.'});
if(R.prescrit>0.5)a.push({niv:'warning',t:'Une partie du rappel est prescrite',m:euro(R.prescrit)+' portent sur des échéances antérieures au '+fmtLong(R.limite)+'. Ces sommes ne sont plus exigibles (article 2224 du code civil).'});
if(d.indice==='ILAT')a.push({niv:'info',t:'Indice ILAT',m:'L\'ILAT vise les activités tertiaires. Pour un restaurant ou un commerce, l\'ILC est l\'indice prévu par l\'article L. 112-2 du code monétaire et financier. Vérifiez la cohérence avec l\'activité autorisée au bail.'});
if(d.indice==='ICC')a.push({niv:'info',t:'Indice ICC',m:'L\'ICC reste un indice licite pour un immeuble bâti. Il est plus volatil que l\'ILC. La révision triennale légale et le plafonnement se calculent désormais sur l\'ILC ou l\'ILAT.'});
return a}

function proposerPremiere(){const de=parseDate(document.getElementById('date_effet').value),pi=document.getElementById('premiere_index');if(!de)return;if(pi.dataset.auto==='1'||!pi.value){pi.value=isoDate(addYears(de,+radio('periode')));pi.dataset.auto='1'}}

// ---------- Interface ----------
document.addEventListener('DOMContentLoaded',function(){
document.querySelectorAll('#simu-index a[href*="calendly.com"]').forEach(a=>{a.href=CALENDLY_URL});
const selA=document.getElementById('ref_annee'),fin=new Date().getFullYear();
for(let y=fin;y>=2008;y--){const o=document.createElement('option');o.value=y;o.textContent=y;selA.appendChild(o)}
document.getElementById('date_calcul').value=isoDate(today());
const maj=window.INDICES&&window.INDICES.maj;
if(maj){const der=dernierTrimestreDispo('ILC');document.getElementById('indices-maj').textContent='Dernier indice intégré : '+qLabel(der)+'.'}
charger();
['change','input'].forEach(ev=>document.getElementById('date_effet').addEventListener(ev,()=>{proposerRef();proposerPremiere();const dp=document.getElementById('date_paye');if(!dp.value)dp.value=document.getElementById('date_effet').value}));
document.querySelectorAll('#simu-index input[name="periode"]').forEach(i=>i.addEventListener('change',proposerPremiere));
document.getElementById('premiere_index').addEventListener('input',function(){delete this.dataset.auto});
const attendu=dernierIndicePublie('ILC',today()),dispo=dernierTrimestreDispo('ILC');if(attendu!=null&&dispo!=null&&attendu>dispo){const al=document.getElementById('indices-alerte');al.hidden=false;al.innerHTML='<strong>Indices en attente de mise à jour</strong>L\'ILC du '+qLabel(attendu)+' devrait être paru ; le simulateur s\'arrête au '+qLabel(dispo)+'. Les indexations les plus récentes peuvent manquer.'}
document.querySelectorAll('#simu-index input[name="indice"]').forEach(i=>i.addEventListener('change',()=>{proposerRef();majPME()}));
['ref_trim','ref_annee'].forEach(id=>document.getElementById(id).addEventListener('change',afficherRef));
document.querySelectorAll('#simu-index input[name="sens"]').forEach(i=>i.addEventListener('change',majSens));
document.querySelectorAll('#simu-index input[name="jeu"]').forEach(i=>i.addEventListener('change',()=>{document.getElementById('demande-group').hidden=radio('jeu')!=='demande'}));
document.getElementById('simu-index').addEventListener('input',sauver);
document.getElementById('simu-index').addEventListener('change',e=>{if(e.target.type==='radio'){document.querySelectorAll('#simu-index input[name="'+e.target.name+'"]').forEach(i=>i.closest('.radio-option').classList.toggle('selected',i.checked))}sauver()});
document.querySelectorAll('#simu-index input[type=radio]:checked').forEach(i=>i.closest('.radio-option').classList.add('selected'));
majSens();majPME();afficherRef();renderExemple();initBulles();initDepot();
document.getElementById('demande-group').hidden=radio('jeu')!=='demande'});

function proposerRef(){const d=parseDate(document.getElementById('date_effet').value);if(!d)return;
const i=dernierIndicePublie(radio('indice'),d);if(i==null)return;
document.getElementById('ref_trim').value=String(i%4+1);document.getElementById('ref_annee').value=String(Math.floor(i/4));afficherRef()}
function afficherRef(){const i=qi(+document.getElementById('ref_annee').value,+document.getElementById('ref_trim').value),v=idx(radio('indice'),i),box=document.getElementById('ref-valeur');
box.hidden=false;box.textContent=v!=null?radio('indice')+' du '+qLabel(i)+' : '+fr(v,radio('indice')==='ICC'?0:2)+' (publié vers le '+fmtLong(datePublication(i))+')':'Indice non disponible pour ce trimestre.'}
function majSens(){const s=radio('sens'),al=document.getElementById('sens-alert');document.getElementById('tunnel-group').hidden=s!=='tunnel';document.getElementById('forfait-group').hidden=s!=='forfait';
if(s==='hausse'||s==='plancher'){al.hidden=false;al.textContent='Cette stipulation est réputée non écrite. Le calcul appliquera l\'indice dans les deux sens et chiffrera ce que le preneur peut réclamer.'}else if(s==='forfait'){al.hidden=false;al.textContent='Une hausse fixe et automatique, sans plafond ni limite de durée, est réputée non écrite (Cass. civ. 3e, 3 septembre 2026, n° 25-14.904). Le calcul retiendra le loyer de référence et chiffrera la restitution due au preneur.'}else al.hidden=true}
function majPME(){document.getElementById('pme-group').hidden=radio('indice')!=='ILC'}

const CHAMPS=['date_effet','loyer_ref','ref_trim','ref_annee','premiere_index','tunnel_pct','forfait_pct','ca','charges','date_demande','loyer_paye','date_paye','depot_garantie','date_med'];
function sauver(){try{const o={t:Date.now()};CHAMPS.forEach(id=>o[id]=document.getElementById(id).value);
['indice','periode','sens','jeu','pme','terme','comp_mode','depot_indexe','bailleur_physique'].forEach(n=>o[n]=radio(n));o.paliers=[...document.querySelectorAll('#paliers .palier')].map(r=>[r.querySelector('input[type=text]').value,r.querySelector('input[type=date]').value]);o.premiere_auto=document.getElementById('premiere_index').dataset.auto||'';localStorage.setItem('simu_index',JSON.stringify(o))}catch(e){}}
function charger(){try{const o=JSON.parse(localStorage.getItem('simu_index'));if(!o||Date.now()-o.t>86400000)return;
['indice','periode','sens','jeu','pme','terme','comp_mode','depot_indexe','bailleur_physique'].forEach(n=>{const el=document.querySelector('#simu-index input[name="'+n+'"][value="'+o[n]+'"]');if(el)el.checked=true});
CHAMPS.forEach(id=>{if(o[id])document.getElementById(id).value=o[id]});(o.paliers||[]).forEach(x=>ajouterPalier(x[0],x[1]));if(o.premiere_auto)document.getElementById('premiere_index').dataset.auto=o.premiere_auto;else if(o.premiere_index)delete document.getElementById('premiere_index').dataset.auto}catch(e){}}

function stepErr(s,m){const e=document.getElementById('step'+s+'-error')||document.getElementById('contact-error');e.textContent=m;e.hidden=false;e.scrollIntoView({block:'nearest'});clearTimeout(e._t);e._t=setTimeout(()=>e.hidden=true,7000)}
function scrollToSim(){const el=document.getElementById('simulateur')||document.getElementById('simu-index');if(el)el.scrollIntoView({block:'start',behavior:'smooth'})}
function goStep(n){document.querySelectorAll('#simu-index .step').forEach(s=>s.classList.toggle('active',+s.dataset.step===n));
document.querySelectorAll('#simu-index .progress-step').forEach(p=>{const k=+p.dataset.step;p.classList.toggle('active',k===n);p.classList.toggle('completed',k<n)});currentStep=n;scrollToSim()}
function nextStep(){if(validateStep(currentStep))goStep(currentStep+1)}
function prevStep(){goStep(currentStep-1)}

function validateStep(s){
if(s===1){const de=parseDate(document.getElementById('date_effet').value);
if(!de)return stepErr(1,'Indiquez la date de prise d\'effet du loyer de référence.'),false;
if(de>today())return stepErr(1,'La date de prise d\'effet ne peut pas être postérieure à aujourd\'hui.'),false;
if(!num('loyer_ref'))return stepErr(1,'Indiquez le loyer annuel HT fixé à cette date, par exemple 24 000.'),false;
const i=qi(+document.getElementById('ref_annee').value,+document.getElementById('ref_trim').value);
if(idx(radio('indice'),i)==null)return stepErr(1,'L\'indice de base choisi n\'est pas disponible. Choisissez un trimestre publié.'),false;
const pi=document.getElementById('premiere_index');if(!pi.value){pi.value=isoDate(addYears(de,+radio('periode')));pi.dataset.auto='1'}
const pd=parseDate(pi.value);if(!pd||pd<=de)return stepErr(1,'La première indexation doit être postérieure à la prise d\'effet du loyer.'),false;
if(moisEntre(de,pd)>36.5)return stepErr(1,'La première indexation ne peut pas intervenir plus de trois ans après la prise d\'effet.'),false}
if(s===2){if(radio('sens')==='forfait'){const f=num('forfait_pct');if(!f||f>=50)return stepErr(2,'Indiquez la hausse annuelle prévue par la clause, par exemple 1,5.'),false}
if(radio('sens')==='tunnel'){const t=num('tunnel_pct');if(!t||t>=50)return stepErr(2,'Indiquez le plafond annuel de variation prévu par la clause, par exemple 3.'),false}}
if(s===3){if(!num('loyer_paye'))return stepErr(3,'Indiquez le loyer annuel HT actuellement payé.'),false;
const dp=parseDate(document.getElementById('date_paye').value),de=parseDate(document.getElementById('date_effet').value),dc=parseDate(document.getElementById('date_calcul').value)||today();
if(!dp)return stepErr(3,'Indiquez depuis quand ce loyer est payé.'),false;
if(dp<de)return stepErr(3,'Cette date ne peut pas précéder la prise d\'effet du loyer de référence ('+fmtDate(de)+').'),false;
if(dp>dc)return stepErr(3,'Cette date ne peut pas être postérieure à la date du calcul.'),false;
if(dc<de)return stepErr(3,'La date du calcul doit être postérieure à la prise d\'effet du loyer.'),false;
for(const r of document.querySelectorAll('#paliers .palier')){const m=toNum(r.querySelector('input[type=text]').value),dt=parseDate(r.querySelector('input[type=date]').value);
if(!m||!dt)return stepErr(3,'Chaque montant antérieur doit avoir un montant et une date.'),false;
if(dt<de)return stepErr(3,'Un montant antérieur ne peut pas précéder la prise d\'effet du loyer ('+fmtDate(de)+').'),false;
if(dt>=dp)return stepErr(3,'Un montant antérieur doit commencer avant le '+fmtDate(dp)+', date du loyer actuel.'),false}
const dm=parseDate(document.getElementById('date_med').value);if(dm&&dm>dc)return stepErr(3,'La mise en demeure ne peut pas être postérieure à la date du calcul.'),false}
if(s===4){const profil=document.getElementById('profil_utilisateur').value,nom=document.getElementById('nom').value.trim(),prenom=document.getElementById('prenom').value.trim(),tel=document.getElementById('telephone').value.trim(),email=document.getElementById('email').value.trim().toLowerCase();
if(!profil)return stepErr(4,'Sélectionnez votre profil.'),false;
if(!nom||!prenom||!tel||!email)return stepErr(4,'Tous les champs sont obligatoires.'),false;
const t=tel.replace(/[\s.\-()]/g,'').replace(/^\+33/,'0').replace(/^0033/,'0');
if(!/^0[1-9]\d{8}$/.test(t)||/^0(\d)\1{8}$/.test(t)||t==='0612345678')return stepErr(4,'Numéro de téléphone invalide : 10 chiffres attendus, par exemple 06 12 34 56 78.'),false;
if(!/^[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(email))return stepErr(4,'Adresse email invalide, par exemple prenom.nom@domaine.fr.'),false;
if(/(yopmail|mailinator|guerrillamail|10minutemail|temp-?mail|jetable|trashmail|maildrop)\./.test(email))return stepErr(4,'Les adresses email temporaires ne sont pas acceptées.'),false}
return true}

function lireDonnees(){return{dateEffet:parseDate(document.getElementById('date_effet').value),loyerRef:num('loyer_ref'),indice:radio('indice'),
refQ:qi(+document.getElementById('ref_annee').value,+document.getElementById('ref_trim').value),periode:+radio('periode'),
premiereIndex:parseDate(document.getElementById('premiere_index').value)||null,compMode:radio('comp_mode')||'meme',
sens:radio('sens')==='inconnu'?'symetrique':radio('sens'),sensInconnu:radio('sens')==='inconnu',tunnel:num('tunnel_pct'),forfait:num('forfait_pct'),jeu:radio('jeu')==='inconnu'?'auto':radio('jeu'),jeuInconnu:radio('jeu')==='inconnu',dateDemande:parseDate(document.getElementById('date_demande').value),
pme:radio('indice')==='ILC'&&radio('pme')==='oui',loyerPaye:num('loyer_paye'),datePaye:parseDate(document.getElementById('date_paye').value),
terme:+radio('terme'),ca:num('ca'),charges:num('charges'),paliers:lirePaliers(),depot:num('depot_garantie'),depotIndexe:radio('depot_indexe')==='oui',dateMED:parseDate(document.getElementById('date_med').value),bailleurPhysique:radio('bailleur_physique')==='oui',dateCalc:parseDate(document.getElementById('date_calcul').value)||today()}}
function lirePaliers(){const rows=[...document.querySelectorAll('#paliers .palier')].map(r=>({montant:toNum(r.querySelector('input[type=text]').value),date:parseDate(r.querySelector('input[type=date]').value)})).filter(x=>x.montant>0&&x.date);
rows.push({montant:num('loyer_paye'),date:parseDate(document.getElementById('date_paye').value)});return rows.filter(x=>x.montant>0&&x.date)}
function ajouterPalier(montant,date){const c=document.getElementById('paliers'),div=document.createElement('div');div.className='palier';
div.innerHTML='<input type="text" inputmode="decimal" placeholder="Montant annuel HT" aria-label="Montant annuel HT payé" autocomplete="off"><span>depuis le</span><input type="date" aria-label="Payé depuis le"><button type="button" class="btn-x" aria-label="Retirer ce montant" onclick="this.closest(\'.palier\').remove();sauver()">×</button>';
if(montant)div.querySelector('input[type=text]').value=montant;if(date)div.querySelector('input[type=date]').value=date;c.appendChild(div)}
function lireContact(){return{profil_utilisateur:document.getElementById('profil_utilisateur').value,nom:document.getElementById('nom').value.trim(),
prenom:document.getElementById('prenom').value.trim(),telephone:document.getElementById('telephone').value.trim(),email:document.getElementById('email').value.trim().toLowerCase()}}

function calculate(){if(!validateStep(4))return;const btn=document.getElementById('btn-calculate');btn.disabled=true;
const d=lireDonnees(),c=lireContact(),R=calculer(d),A=controles(d,R);resultat={d,c,R,A};
sendLead(c,d,R);renderResults();btn.disabled=false}

function renderResults(){const{d,c,R,A}=resultat;
const ecartAn=R.loyerDu-d.loyerPaye;
const sensLbl=R.exigible>=0?tip('Rattrapage','rattrapage')+' exigible par le bailleur':'Trop-perçu à restituer au preneur';
document.getElementById('summary').innerHTML=
'<div class="kpi"><div class="k-label">Loyer annuel dû au '+fmtDate(d.dateCalc)+'</div><div class="k-value">'+euro(R.loyerDu)+'</div><div class="k-sub">HT hors charges · '+pct(R.variationTotale)+' depuis le '+fmtDate(d.dateEffet)+'</div></div>'+
'<div class="kpi"><div class="k-label">Écart avec le loyer payé</div><div class="k-value">'+(ecartAn>=0?'+':'−')+euro(Math.abs(ecartAn))+'</div><div class="k-sub">par an, sur la base de '+euro(d.loyerPaye)+' payés</div></div>'+
'<div class="kpi hl"><div class="k-label">'+sensLbl+'</div><div class="k-value">'+euro(Math.abs(R.exigible))+'</div><div class="k-sub">échéances depuis le '+fmtDate(R.limite)+(R.prescrit>0.5?' · '+euro(R.prescrit)+' '+tip('prescrits','prescription'):'')+'</div></div>';
const plus=[];if(R.interets)plus.push('<div><span>Intérêts au taux légal depuis le '+fmtDate(R.interets.depuis)+'</span><strong>'+euro(R.interets.total,true)+'</strong></div>');if(R.depot)plus.push('<div><span>Complément de dépôt de garantie</span><strong>'+euro(Math.max(0,R.depot.complement),true)+'</strong></div>');const spl=document.getElementById('summary-plus');spl.innerHTML=plus.join('');spl.hidden=!plus.length;
document.getElementById('alerts').innerHTML=ampleurHTML(ampleur(d,R))+A.map(a=>'<div class="alert alert-'+(a.niv==='info'?'warning':a.niv)+'"><strong>'+a.t+'</strong>'+a.m+'</div>').join('');
renderEffort(d,R);
document.getElementById('chrono-resultat').innerHTML=friseCourte(d,R)+'<details class="detail"><summary>Voir le détail des calculs</summary>'+chronologie(d,R)+'</details>';
const tb=document.querySelector('#table-index tbody');let h='<tr><td>'+fmtDate(d.dateEffet)+'</td><td>'+d.indice+' '+qLabel(d.refQ)+' · '+fr(idx(d.indice,d.refQ),d.indice==='ICC'?0:2)+'</td><td class="num">base</td><td class="num">'+euro(d.loyerRef,true)+'</td></tr>';
R.ev.forEach(e=>{if(e.flags.includes('forfait')){h+='<tr><td>'+fmtDate(e.date)+'</td><td>Hausse forfaitaire écartée <span class="pill pill-cap">Réputée non écrite</span><br><span class="note">Clause appliquée : '+euro(e.loyerHausse,true)+'</span></td><td class="num">'+pct(0)+'</td><td class="num">'+euro(e.loyer,true)+'</td></tr>';return}const pills=e.flags.map(f=>' <span class="pill pill-cap">'+(f==='bouclier'?'Bouclier 3,5 %':'Tunnel')+'</span>').join('');
h+='<tr><td>'+fmtDate(e.date)+'</td><td>'+d.indice+' '+qLabel(e.comp)+' · '+fr(e.valeur,d.indice==='ICC'?0:2)+pills+'</td><td class="num '+(e.variation>=0?'pos':'neg')+'">'+pct(e.variation)+'</td><td class="num">'+euro(e.loyer,true)+'</td></tr>'});
tb.innerHTML=h;
document.getElementById('table-note').textContent='Méthode : loyer de référence multiplié par la variation de l\'indice du même trimestre, à '+(d.periode===1?'un an':'trois ans')+' d\'écart. '+(R.ev.some(e=>e.flags.length)?'Les plafonds sont appliqués année par année puis chaînés. ':'')+'Montants arrondis au centime.';
const tr=document.querySelector('#table-ratt tbody');let t='',sd=0,sp=0,se=0;
R.annees.forEach(l=>{sd+=l.du;sp+=l.paye;se+=l.ecart;const coupe=R.annees.some(o=>o.annee===l.annee&&o.prescrit!==l.prescrit);t+='<tr class="'+(l.prescrit?'old':'')+'"><td>'+l.annee+(coupe?(l.prescrit?' · avant le ':' · depuis le ')+fmtDate(R.limite).slice(0,5):'')+'</td><td class="num">'+euro(l.du)+'</td><td class="num">'+euro(l.paye)+'</td><td class="num '+(l.ecart>0.5?'pos':l.ecart<-0.5?'neg':'')+'">'+(l.ecart>=0?'+':'−')+euro(Math.abs(l.ecart))+'</td><td>'+(l.prescrit?'<span class="pill pill-old">Prescrit</span>':'<span class="pill pill-ok">Exigible</span>')+'</td></tr>'});
t+='<tr class="total"><td>Total non prescrit</td><td></td><td></td><td class="num">'+(R.exigible>=0?'+':'−')+euro(Math.abs(R.exigible))+'</td><td></td></tr>';
tr.innerHTML=t;
switchRole(['bailleur','gestionnaire'].includes(c.profil_utilisateur)?'bailleur':'preneur');
document.querySelectorAll('#simu-index .step').forEach(s=>s.classList.remove('active'));
document.getElementById('results').hidden=false;document.getElementById('results').classList.add('active');
document.querySelectorAll('#simu-index .progress-step').forEach(p=>{p.classList.remove('active');p.classList.add('completed')});scrollToSim()}

// ---------- Textes ----------
function recapIndexations(d,R){if(d.sens==='forfait')return R.ev.map(e=>'- '+fmtLong(e.date)+' : hausse forfaitaire écartée, loyer dû '+euro(e.loyer,true)+' HT (la clause aurait porté le loyer à '+euro(e.loyerHausse,true)+' HT)').join('\n')||'- Aucune date anniversaire échue.';
return R.ev.map(e=>'- '+fmtLong(e.date)+' : '+d.indice+' du '+qLabel(e.comp)+' ('+fr(e.valeur,d.indice==='ICC'?0:2)+'), '+pct(e.variation)+', loyer annuel '+euro(e.loyer,true)+' HT'+(e.flags.includes('bouclier')?' (plafonné à 3,5 %)':'')).join('\n')||'- Aucune date d\'indexation échue.'}
function effortTexte(d,R){const A=ampleur(d,R),L=tauxEffort(d,R);const v=A?'\n\nAmpleur : '+A.niv.lib.toLowerCase()+'. '+A.ph.slice(0,2).join(' '):'';if(!L)return v;return v+'\n\nTaux d\'effort (loyer annuel HT'+(d.charges?' et charges':'')+' ÷ chiffre d\'affaires HT) :\n'+L.map(x=>'- '+x.lib+' : '+fr(x.v*100,1)+' % ('+niveau(x.v).lib.toLowerCase()+')').join('\n')}
function pointsControle(A){return A.length?A.map(a=>'⚠ '+a.t+' : '+a.m).join('\n'):'Aucun point d\'alerte sur les éléments renseignés.'}
function genTexte(type){const{d,R,A}=resultat;const ref=d.indice+' du '+qLabel(d.refQ)+' ('+fr(idx(d.indice,d.refQ),d.indice==='ICC'?0:2)+')';
const du=R.exigible>0.5,trop=R.exigible<-0.5;
const base='Loyer de référence : '+euro(d.loyerRef,true)+' HT par an au '+fmtLong(d.dateEffet)+', indice de base '+ref+'.\nIndexation '+(d.periode===1?'annuelle':'triennale')+' sur l\''+NOM_INDICE[d.indice]+'.\nLoyer indexé dû au '+fmtLong(d.dateCalc)+' : '+euro(R.loyerDu,true)+' HT par an.'+(d.paliers.length>1?'\nLoyer payé : '+d.paliers.map(x=>euro(x.montant,true)+' HT par an depuis le '+fmtLong(x.date)).join(', puis ')+'.':'\nLoyer payé depuis le '+fmtLong(d.datePaye)+' : '+euro(d.loyerPaye,true)+' HT par an.')+(R.interets?'\nIntérêts au taux légal depuis la mise en demeure du '+fmtLong(R.interets.depuis)+' : '+euro(R.interets.total,true)+'.':'')+(R.depot&&R.depot.complement>0.5?'\nComplément de dépôt de garantie indexé : '+euro(R.depot.complement,true)+'.':'');
if(type==='analyse_p')return 'INDEXATION DU LOYER - ANALYSE CÔTÉ PRENEUR\n\n'+base+'\n\n'+
(du?'Le bailleur peut réclamer '+euro(R.exigible,true)+' au titre des échéances non prescrites, depuis le '+fmtLong(R.limite)+'.':trop?'Vous avez versé '+euro(-R.exigible,true)+' de trop sur les échéances non prescrites : ce trop-perçu vous est dû.':'Le loyer payé correspond au loyer indexé.')+
(R.prescrit>0.5?'\n'+euro(R.prescrit,true)+' sont prescrits et ne peuvent plus être réclamés.':'')+
'\n\nIndexations successives :\n'+recapIndexations(d,R)+effortTexte(d,R)+'\n\nPoints de contrôle :\n'+pointsControle(A)+
'\n\nAvant de répondre au bailleur :\n- Ne reconnaissez pas la dette par écrit tant que le calcul n\'est pas vérifié : une reconnaissance interrompt la prescription (article 2240 du code civil).\n- Demandez le détail du calcul, les indices retenus et la date de chaque indexation.\n- Vérifiez la rédaction exacte de la clause : sens de la variation, indice de base, jeu automatique ou sur demande.\n- Un commandement de payer visant la clause résolutoire laisse un mois pour régler (article L. 145-41 du code de commerce). Des délais de paiement peuvent être demandés au juge (article 1343-5 du code civil).\n\nPièces à réunir : le bail et ses avenants, les avis d\'échéance depuis le '+fmtLong(d.datePaye)+', les courriers du bailleur sur le loyer.';
if(type==='courrier_p'){if(trop||hausseSeule(d)||d.sens==='forfait'||R.distorsion)return 'Objet : Indexation du loyer - demande de régularisation\n\nMadame, Monsieur,\n\nJe suis titulaire du bail commercial portant sur les locaux que vous me louez, dont le loyer a été fixé à '+euro(d.loyerRef,true)+' HT par an à compter du '+fmtLong(d.dateEffet)+'.\n\n'+
(d.sens==='forfait'?'Le bail prévoit une augmentation automatique du loyer de '+String(d.forfait).replace('.',',')+' % par an, sans plafond ni limite de durée. Une telle clause organise une révision du loyer à la seule hausse. Elle est réputée non écrite (Cass. civ. 3e, 3 septembre 2026, n° 25-14.904). Le loyer dû reste donc de '+euro(d.loyerRef,true)+' HT par an.\n\n':'')+
(hausseSeule(d)?(d.sens==='plancher'?'La clause d\'indexation du bail interdit au loyer de descendre sous le loyer de départ. Une telle stipulation écarte la baisse et est réputée non écrite (Cass. civ. 3e, 12 janvier 2022, n° 21-11.169). L\'indice doit donc s\'appliquer dans les deux sens.':'La clause d\'indexation du bail ne joue qu\'à la hausse. Une telle stipulation est réputée non écrite (Cass. civ. 3e, 12 janvier 2022, n° 21-11.169). L\'indice doit donc s\'appliquer dans les deux sens.')+'\n\n':'')+
(R.distorsion?'La clause compare '+Math.round(R.distorsion.moisIdx)+' mois d\'indice pour '+Math.round(R.distorsion.moisRev)+' mois de loyer. Cette distorsion est prohibée par l\'article L. 112-1 du code monétaire et financier et la stipulation est réputée non écrite.\n\n':'')+
(d.sens==='forfait'?'':'Selon mon calcul, fondé sur l\''+NOM_INDICE[d.indice]+', le loyer dû au '+fmtLong(d.dateCalc)+' s\'établit à '+euro(R.loyerDu,true)+' HT par an. ')+(trop?'Sur les cinq dernières années, j\'ai réglé '+euro(-R.exigible,true)+' de plus que le loyer dû.':'')+'\n\n'+(d.sens==='forfait'?'Détail par date anniversaire':'Indexations retenues')+' :\n'+recapIndexations(d,R)+'\n\nJe vous remercie de bien vouloir régulariser la situation'+(trop?' et me restituer cette somme':'')+', ou de me communiquer '+(d.sens==='forfait'?'votre position':'votre propre calcul, avec les indices retenus')+', dans un délai de trente jours.\n\nJe vous prie d\'agréer, Madame, Monsieur, mes salutations distinguées.';
return 'Objet : Indexation du loyer - demande de décompte\n\nMadame, Monsieur,\n\nJe suis titulaire du bail commercial portant sur les locaux que vous me louez, dont le loyer a été fixé à '+euro(d.loyerRef,true)+' HT par an à compter du '+fmtLong(d.dateEffet)+'.\n\nAfin de vérifier l\'application de la clause d\'indexation, je vous remercie de me communiquer un décompte détaillé : date de chaque indexation, indices comparés et loyer qui en résulte.\n\nÀ réception, je reviendrai vers vous sur les modalités de régularisation éventuelle.\n\nLe présent courrier ne vaut pas reconnaissance d\'une somme due.\n\nJe vous prie d\'agréer, Madame, Monsieur, mes salutations distinguées.'}
if(type==='analyse_b')return 'INDEXATION DU LOYER - ANALYSE CÔTÉ BAILLEUR\n\n'+base+'\n\n'+
(du?'Rappel exigible : '+euro(R.exigible,true)+' HT, sur les échéances postérieures au '+fmtLong(R.limite)+'.':trop?'Attention : le loyer perçu dépasse le loyer indexé de '+euro(-R.exigible,true)+' sur cinq ans. Le preneur peut en demander la restitution.':'Le loyer perçu correspond au loyer indexé.')+
(R.prescrit>0.5?'\nPrescrit : '+euro(R.prescrit,true)+'. Chaque échéance se prescrit par cinq ans (article 2224 du code civil) : chaque mois d\'attente fait perdre une échéance.':'')+
'\n\nIndexations successives :\n'+recapIndexations(d,R)+effortTexte(d,R)+'\n\nPoints de contrôle :\n'+pointsControle(A)+
'\n\nPour sécuriser la demande :\n- Adressez-la par lettre recommandée avec avis de réception ou par commissaire de justice. La mise en demeure fait courir les intérêts au taux légal (article 1344-1 du code civil).\n- Seule une demande en justice, une mesure d\'exécution ou une reconnaissance du preneur interrompt la prescription (articles 2240 à 2244 du code civil). Un simple courrier ne l\'interrompt pas.\n- Joignez le détail des indices : un décompte vérifiable limite la contestation.\n- Un échéancier amiable évite souvent le contentieux.'+(hausseSeule(d)?'\n- Votre clause écarte la baisse : elle est exposée. Ne réclamez pas plus que l\'application de l\'indice dans les deux sens.':'')+(R.distorsion?'\n- Votre clause compare plus de mois d\'indice que de mois de loyer : elle est exposée au réputé non écrit (article L. 112-1 du code monétaire et financier). Faites-la vérifier avant toute réclamation.':'')+(R.interets?'\n- Intérêts au taux légal depuis la mise en demeure du '+fmtLong(R.interets.depuis)+' : '+euro(R.interets.total,true)+' à ce jour, à réclamer avec le principal.':'')+(R.depot&&R.depot.complement>0.5?'\n- Complément de dépôt de garantie : '+euro(R.depot.complement,true)+', si le bail prévoit son indexation.':'');
if(d.sens==='forfait')return 'Aucun modèle de demande n\'est proposé.\n\nLa clause de hausse forfaitaire automatique est réputée non écrite (Cass. civ. 3e, 3 septembre 2026, n° 25-14.904). Réclamer une hausse sur ce fondement exposerait à une demande de restitution des sommes perçues depuis cinq ans.\n\nPour faire évoluer le loyer : révision triennale légale (article L. 145-38 du code de commerce) ou avenant instituant une clause d\'indexation sur l\'ILC, jouant à la hausse comme à la baisse.';
return 'Objet : Application de la clause d\'indexation - rappel de loyers\n\nLettre recommandée avec avis de réception\n\nMadame, Monsieur,\n\nLe bail commercial qui nous lie stipule une indexation '+(d.periode===1?'annuelle':'triennale')+' du loyer sur l\''+NOM_INDICE[d.indice]+'. Le loyer a été fixé à '+euro(d.loyerRef,true)+' HT par an à compter du '+fmtLong(d.dateEffet)+', sur la base de l\'indice du '+qLabel(d.refQ)+'.\n\n'+
(d.jeu==='demande'?'Par la présente, je vous demande l\'application de cette clause.\n\n':'')+
'En application de cette clause, le loyer s\'établit comme suit :\n'+recapIndexations(d,R)+'\n\nLe loyer dû à ce jour est donc de '+euro(R.loyerDu,true)+' HT par an, contre '+euro(d.loyerPaye,true)+' HT réglés actuellement.\n\n'+
(du?'Le rappel dû au titre des échéances échues depuis le '+fmtLong(R.limite)+' s\'élève à '+euro(R.exigible,true)+' HT, TVA en sus le cas échéant.'+(R.interets?' Cette somme porte intérêts au taux légal depuis ma mise en demeure du '+fmtLong(R.interets.depuis)+', soit '+euro(R.interets.total,true)+' à ce jour.':'')+(R.depot&&R.depot.complement>0.5?'\n\nLe dépôt de garantie suivant le loyer, je vous remercie également de le compléter de '+euro(R.depot.complement,true)+'.':'')+'\n\nJe vous remercie de bien vouloir régler cette somme dans un délai de trente jours et d\'appliquer le loyer indexé dès la prochaine échéance. Je reste ouvert à un échéancier si vous le souhaitez.':'Je vous remercie d\'appliquer le loyer indexé dès la prochaine échéance.')+
'\n\nJe vous prie d\'agréer, Madame, Monsieur, mes salutations distinguées.'}

function switchRole(role){currentRole=role;
document.querySelectorAll('#simu-index .narrative-role').forEach(r=>r.classList.toggle('active',r.dataset.role===role));
document.querySelectorAll('#simu-index .narrative-tabs').forEach(t=>t.hidden=t.dataset.role!==role);
switchNarrative(role==='bailleur'?'analyse_b':'analyse_p')}
function switchNarrative(type){currentType=type;
document.querySelectorAll('#simu-index .narrative-tab').forEach(t=>t.classList.toggle('active',t.dataset.type===type));
narrativeText=genTexte(type);document.getElementById('narrative-text').textContent=narrativeText}
const AVERTISSEMENT='---\nModèle indicatif généré par le simulateur d\'indexation de Louis Pinet, avocat des restaurateurs. Il ne constitue ni une consultation, ni un décompte opposable. À faire relire avant tout envoi.\nPrendre rendez-vous : '+CALENDLY_URL;
function texteExport(){return narrativeText+'\n\n'+AVERTISSEMENT}
function copyNarrative(){const ok=()=>{const s=document.getElementById('copy-success');s.hidden=false;setTimeout(()=>s.hidden=true,3000)};
try{navigator.clipboard.writeText(texteExport()).then(ok).catch(selectText)}catch(e){selectText()}}
function selectText(){const r=document.createRange();r.selectNodeContents(document.getElementById('narrative-text'));const s=window.getSelection();s.removeAllRanges();s.addRange(r)}
function exportPDF(){if(!window.jspdf)return copyNarrative();const{jsPDF}=window.jspdf;const doc=new jsPDF();
doc.setFontSize(15);doc.text('Indexation du loyer commercial',20,20);doc.setFontSize(11);
const lines=doc.splitTextToSize(texteExport().replace(/⚠/g,'!').replace(/−/g,'-').replace(/ | /g,' '),170);let y=34;
lines.forEach(l=>{if(y>282){doc.addPage();y=20}doc.text(l,20,y);y+=5.6});doc.save('indexation-loyer.pdf')}

let leadEnvoye=false;
function sendLead(c,d,R){if(leadEnvoye)return;leadEnvoye=true;
const corps={...c,simulateur:'indexation',loyer:d.loyerPaye,loyer_ref:d.loyerRef,date_effet:isoDate(d.dateEffet),indice:d.indice,indice_base:qKey(d.refQ),
periode:d.periode,sens:d.sens,jeu:d.jeu,pme:d.pme,date_paye:isoDate(d.datePaye),loyer_du:R.loyerDu,premiere_index:isoDate(d.premiereIndex),comp_mode:d.compMode,paliers:d.paliers.length,depot:d.depot||null,depot_indexe:d.depotIndexe,date_med:d.dateMED?isoDate(d.dateMED):null,distorsion:!!R.distorsion,interets:R.interets?R.interets.total:null,bail_lu:bailLu,bail_dossier:bailDossier,ca:d.ca||null,charges:d.charges||null,rattrapage_exigible:R.exigible,montant_prescrit:R.prescrit};
try{fetch(LEAD_ENDPOINT,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(corps),keepalive:true}).catch(()=>{})}catch(e){}}
function resetSim(){try{localStorage.removeItem('simu_index')}catch(e){}location.reload()}
