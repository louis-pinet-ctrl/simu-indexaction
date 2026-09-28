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
function euro(n,dec){return new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',minimumFractionDigits:dec?2:0,maximumFractionDigits:dec?2:0}).format(n)}
function pct(x){return (x>=0?'+':'')+(x*100).toFixed(2).replace('.',',')+' %'}
function fr(n,d){return n.toFixed(d).replace('.',',')}
function r2(n){return Math.round(n*100)/100}
function radio(name){const c=document.querySelector('#simu-index input[name="'+name+'"]:checked');return c?c.value:null}
function cap(s){return s.charAt(0).toUpperCase()+s.slice(1)}
function today(){const n=new Date();return new Date(Date.UTC(n.getFullYear(),n.getMonth(),n.getDate()))}

// Date de publication approximative d'un trimestre : fin du trimestre suivant (T1 fin juin, T4 fin mars).
function datePublication(i){const y=Math.floor(i/4),q=i%4+1;return new Date(Date.UTC(q===4?y+1:y,q===4?2:q*3+2,20))}
function dernierIndicePublie(indice,d){let i=qi(d.getUTCFullYear(),Math.floor(d.getUTCMonth()/3)+1);for(let n=0;n<8;n++,i--){if(datePublication(i)<=d&&idx(indice,i)!=null)return i}return null}
function dernierTrimestreDispo(indice){const s=(window.INDICES||{})[indice]||{};let best=null;Object.keys(s).forEach(k=>{const m=/^(\d{4})-T([1-4])$/.exec(k);if(m&&typeof s[k]==='number'){const i=qi(+m[1],+m[2]);if(best===null||i>best)best=i}});return best}

// ---------- Moteur de calcul ----------
// Variation annuelle entre le trimestre i-4 et le trimestre i, après bouclier PME et clause tunnel.
function ratioAnnuel(d,i){const a=idx(d.indice,i-4),b=idx(d.indice,i);if(a==null||b==null)return null;
let r=b/a,brut=r,flags=[];
if(d.indice==='ILC'&&d.pme&&i>=BOUCLIER.debut&&i<=BOUCLIER.fin&&r>1+BOUCLIER.taux){r=1+BOUCLIER.taux;flags.push('bouclier')}
if(d.sens==='tunnel'&&d.tunnel>0){const t=d.tunnel/100;if(r>1+t){r=1+t;flags.push('tunnel')}else if(r<1-t){r=1-t;flags.push('tunnel')}}
return{r,brut,flags}}

function indexations(d){const ev=[];let facteur=1,loyerHausse=d.loyerRef,pending=null;
for(let k=1;k<200;k++){const date=addYears(d.dateEffet,k*d.periode);if(date>d.dateCalc)break;
const comp=d.refQ+4*k*d.periode;let f=facteur,ok=true,flags=[];
for(let j=comp-4*d.periode+4;j<=comp;j+=4){const ra=ratioAnnuel(d,j);if(!ra){ok=false;break}f*=ra.r;flags=flags.concat(ra.flags)}
if(!ok){pending={date,comp};break}
const variation=f/facteur-1;facteur=f;
const loyer=r2(d.loyerRef*facteur);
loyerHausse=r2(Math.max(loyerHausse,loyerHausse*(1+variation)));
ev.push({date,comp,valeur:idx(d.indice,comp),variation,loyer,loyerHausse,flags:[...new Set(flags)]})}
return{ev,pending}}

function loyerEnVigueur(d,ev,t,champ){let l=d.loyerRef;for(const e of ev){if(e.date<=t)l=e[champ]||e.loyer;else break}return l}

// Échéances à terme à échoir : le 1er de chaque mois ou de chaque trimestre civil.
function echeances(d){const out=[];let e=new Date(Date.UTC(d.dateEffet.getUTCFullYear(),d.dateEffet.getUTCMonth(),1));
if(d.terme===3)e=new Date(Date.UTC(e.getUTCFullYear(),Math.floor(e.getUTCMonth()/3)*3,1));
while(e<=d.dateCalc){const fin=addMonths(e,d.terme);if(fin>d.dateEffet)out.push({debut:e<d.dateEffet?d.dateEffet:e,exig:e,fin});e=fin}return out}

// Montant d'une période au prorata des jours, selon le loyer annuel en vigueur chaque jour.
function montantPeriode(d,ev,p,champ){let total=0,t=p.debut;const bornes=ev.map(e=>e.date).filter(x=>x>p.debut&&x<p.fin);bornes.push(p.fin);
for(const b of bornes){total+=loyerEnVigueur(d,ev,t,champ)*days(t,b)/365;t=b}return total}

function calculer(d){const{ev,pending}=indexations(d);const limite=addYears(d.dateCalc,-PRESCRIPTION_ANS);
const champPaye=d.sens==='hausse'?'loyerHausse':'loyer';
const lignes={},periodes=echeances(d);let exigible=0,prescrit=0,restitTotale=0;
for(const p of periodes){
  let du=montantPeriode(d,ev,p,'loyer');
  let paye;
  if(p.debut>=d.datePaye)paye=d.loyerPaye*days(p.debut,p.fin)/365;
  else paye=montantPeriode(d,ev,p,champPaye);
  // Clause sur demande : pas de rappel avant la demande du bailleur.
  if(d.jeu==='demande'&&p.debut>=d.datePaye&&(!d.dateDemande||p.exig<d.dateDemande))du=paye;
  const ecart=du-paye,estPrescrit=p.exig<limite;
  const cle=p.exig.getUTCFullYear()+(estPrescrit?'p':'e');
  if(!lignes[cle])lignes[cle]={annee:p.exig.getUTCFullYear(),prescrit:estPrescrit,du:0,paye:0,ecart:0};
  lignes[cle].du+=du;lignes[cle].paye+=paye;lignes[cle].ecart+=ecart;
  if(estPrescrit)prescrit+=ecart;else exigible+=ecart;
  if(!estPrescrit)restitTotale+=Math.max(0,paye-d.loyerRef*days(p.debut,p.fin)/365)}
const annees=Object.values(lignes).filter(l=>Math.abs(l.ecart)>0.5||l.annee>=d.datePaye.getUTCFullYear()).sort((a,b)=>a.annee-b.annee||(a.prescrit?-1:1));
const loyerDu=loyerEnVigueur(d,ev,d.dateCalc,'loyer');
const variationTotale=loyerDu/d.loyerRef-1;
let quart=null;for(const e of ev){if(Math.abs(e.loyer/d.loyerRef-1)>0.25){quart=e;break}}
return{ev,pending,annees,exigible:r2(exigible),prescrit:r2(prescrit),restitTotale:r2(restitTotale),loyerDu,variationTotale,quart,limite}}

// ---------- Contrôles juridiques ----------
function controles(d,R){const a=[];
if(d.sens==='hausse')a.push({niv:'danger',t:'Clause à la hausse seulement',m:'Une clause qui écarte la baisse est réputée non écrite (Cass. 3e civ., 12 janv. 2022, n° 21-11.169). En principe, seule la stipulation qui écarte la baisse tombe : le calcul ci-dessous applique l\'indice dans les deux sens. Si la clause était jugée indivisible, le loyer dû redeviendrait le loyer de référence et le locataire pourrait récupérer '+euro(R.restitTotale)+' sur les cinq dernières années (Cass. 3e civ., 23 janv. 2025, n° 23-18.643).'});
if(d.sens==='tunnel'&&d.indice!=='ILC')a.push({niv:'warning',t:'Tunnel sur un indice autre que l\'ILC',m:'L\'article L. 145-38-1 du code de commerce n\'autorise expressément que l\'encadrement de la variation de l\'ILC. Sur l\'ILAT ou l\'ICC, la validité de la clause reste à analyser.'});
else if(d.sens==='tunnel'&&d.dateEffet<new Date(Date.UTC(2026,4,28)))a.push({niv:'warning',t:'Clause tunnel antérieure au 28 mai 2026',m:'L\'article L. 145-38-1 est issu de la loi n° 2026-403 du 26 mai 2026. Son application aux baux conclus avant cette date est à vérifier au regard des dispositions transitoires de la loi.'});
if(R.ev.some(e=>e.flags.includes('bouclier')))a.push({niv:'ok',t:'Bouclier PME appliqué',m:'La variation annuelle de l\'ILC a été plafonnée à 3,5 % pour les trimestres du 2e trimestre 2022 au 1er trimestre 2024. Ce plafonnement est définitivement acquis (loi n° 2022-1158 du 16 août 2022, art. 14).'});
else if(d.indice==='ILC'&&!d.pme&&R.ev.some(e=>e.comp>=BOUCLIER.debut&&e.comp-4*d.periode<=BOUCLIER.fin))a.push({niv:'warning',t:'Bouclier non appliqué',m:'Vous avez indiqué que le locataire n\'est pas une PME. Si c\'est le cas, la variation de l\'ILC entre le 2e trimestre 2022 et le 1er trimestre 2024 aurait dû être plafonnée à 3,5 % par an.'});
if(R.quart)a.push({niv:'warning',t:'Seuil du quart franchi',m:'Depuis l\'indexation du '+fmtDate(R.quart.date)+', le loyer a varié de plus de 25 % par rapport au loyer de référence ('+pct(R.quart.loyer/d.loyerRef-1)+'). Chaque partie peut demander la révision à la valeur locative, avec une hausse limitée à 10 % par an (article L. 145-39 du code de commerce).'});
if(d.jeu==='demande'&&!d.dateDemande)a.push({niv:'warning',t:'Aucune demande d\'indexation',m:'La clause subordonne l\'indexation à une demande du bailleur. Sans demande, aucun rappel n\'est calculé. Le loyer indexé s\'appliquera en principe à compter de la demande : '+euro(R.loyerDu,true)+' HT par an à ce jour.'});
if(R.pending)a.push({niv:'warning',t:'Indice pas encore publié',m:'L\'indexation du '+fmtDate(R.pending.date)+' suppose l\'indice du '+qLabel(R.pending.comp)+', qui n\'est pas encore paru. Elle sera calculable à sa publication.'});
if(R.prescrit>0.5)a.push({niv:'warning',t:'Une partie du rappel est prescrite',m:euro(R.prescrit)+' portent sur des échéances antérieures au '+fmtDate(R.limite)+'. Ces sommes ne sont plus exigibles (article 2224 du code civil).'});
if(d.indice==='ILAT')a.push({niv:'info',t:'Indice ILAT',m:'L\'ILAT vise les activités tertiaires. Pour un restaurant ou un commerce, l\'ILC est l\'indice prévu par l\'article L. 112-2 du code monétaire et financier. Vérifiez la cohérence avec l\'activité autorisée au bail.'});
if(d.indice==='ICC')a.push({niv:'info',t:'Indice ICC',m:'L\'ICC reste un indice licite pour un immeuble bâti. Il est plus volatil que l\'ILC. La révision triennale légale et le plafonnement se calculent désormais sur l\'ILC ou l\'ILAT.'});
return a}

// ---------- Interface ----------
document.addEventListener('DOMContentLoaded',function(){
document.querySelectorAll('#simu-index a[href*="calendly.com"]').forEach(a=>{a.href=CALENDLY_URL});
const selA=document.getElementById('ref_annee'),fin=new Date().getFullYear();
for(let y=fin;y>=2008;y--){const o=document.createElement('option');o.value=y;o.textContent=y;selA.appendChild(o)}
document.getElementById('date_calcul').value=isoDate(today());
const maj=window.INDICES&&window.INDICES.maj;
if(maj){const der=dernierTrimestreDispo('ILC');document.getElementById('indices-maj').textContent='Dernier indice intégré : '+qLabel(der)+'.'}
charger();
document.getElementById('date_effet').addEventListener('change',()=>{proposerRef();const dp=document.getElementById('date_paye');if(!dp.value)dp.value=document.getElementById('date_effet').value});
document.querySelectorAll('#simu-index input[name="indice"]').forEach(i=>i.addEventListener('change',()=>{proposerRef();majPME()}));
['ref_trim','ref_annee'].forEach(id=>document.getElementById(id).addEventListener('change',afficherRef));
document.querySelectorAll('#simu-index input[name="sens"]').forEach(i=>i.addEventListener('change',majSens));
document.querySelectorAll('#simu-index input[name="jeu"]').forEach(i=>i.addEventListener('change',()=>{document.getElementById('demande-group').hidden=radio('jeu')!=='demande'}));
document.getElementById('simu-index').addEventListener('input',sauver);
document.getElementById('simu-index').addEventListener('change',e=>{if(e.target.type==='radio'){document.querySelectorAll('#simu-index input[name="'+e.target.name+'"]').forEach(i=>i.closest('.radio-option').classList.toggle('selected',i.checked))}sauver()});
document.querySelectorAll('#simu-index input[type=radio]:checked').forEach(i=>i.closest('.radio-option').classList.add('selected'));
majSens();majPME();afficherRef();
document.getElementById('demande-group').hidden=radio('jeu')!=='demande'});

function proposerRef(){const d=parseDate(document.getElementById('date_effet').value);if(!d)return;
const i=dernierIndicePublie(radio('indice'),d);if(i==null)return;
document.getElementById('ref_trim').value=String(i%4+1);document.getElementById('ref_annee').value=String(Math.floor(i/4));afficherRef()}
function afficherRef(){const i=qi(+document.getElementById('ref_annee').value,+document.getElementById('ref_trim').value),v=idx(radio('indice'),i),box=document.getElementById('ref-valeur');
box.hidden=false;box.textContent=v!=null?radio('indice')+' du '+qLabel(i)+' : '+fr(v,radio('indice')==='ICC'?0:2):'Indice non disponible pour ce trimestre.'}
function majSens(){const s=radio('sens'),al=document.getElementById('sens-alert');document.getElementById('tunnel-group').hidden=s!=='tunnel';
if(s==='hausse'){al.hidden=false;al.textContent='Cette stipulation est réputée non écrite. Le calcul appliquera l\'indice dans les deux sens et chiffrera ce que le locataire peut réclamer.'}else al.hidden=true}
function majPME(){document.getElementById('pme-group').hidden=radio('indice')!=='ILC'}

const CHAMPS=['date_effet','loyer_ref','ref_trim','ref_annee','tunnel_pct','date_demande','loyer_paye','date_paye'];
function sauver(){try{const o={t:Date.now()};CHAMPS.forEach(id=>o[id]=document.getElementById(id).value);
['indice','periode','sens','jeu','pme','terme'].forEach(n=>o[n]=radio(n));localStorage.setItem('simu_index',JSON.stringify(o))}catch(e){}}
function charger(){try{const o=JSON.parse(localStorage.getItem('simu_index'));if(!o||Date.now()-o.t>7*86400000)return;
['indice','periode','sens','jeu','pme','terme'].forEach(n=>{const el=document.querySelector('#simu-index input[name="'+n+'"][value="'+o[n]+'"]');if(el)el.checked=true});
CHAMPS.forEach(id=>{if(o[id])document.getElementById(id).value=o[id]})}catch(e){}}

function stepErr(s,m){const e=document.getElementById('step'+s+'-error')||document.getElementById('contact-error');e.textContent=m;e.hidden=false;e.scrollIntoView({block:'nearest'});clearTimeout(e._t);e._t=setTimeout(()=>e.hidden=true,7000)}
function scrollToSim(){const el=document.getElementById('simu-index');if(el)el.scrollIntoView({block:'start',behavior:'smooth'})}
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
if(idx(radio('indice'),i)==null)return stepErr(1,'L\'indice de base choisi n\'est pas disponible. Choisissez un trimestre publié.'),false}
if(s===2){if(radio('sens')==='tunnel'){const t=num('tunnel_pct');if(!t||t>=50)return stepErr(2,'Indiquez le plafond annuel de variation prévu par la clause, par exemple 3.'),false}}
if(s===3){if(!num('loyer_paye'))return stepErr(3,'Indiquez le loyer annuel HT actuellement payé.'),false;
const dp=parseDate(document.getElementById('date_paye').value),de=parseDate(document.getElementById('date_effet').value),dc=parseDate(document.getElementById('date_calcul').value)||today();
if(!dp)return stepErr(3,'Indiquez depuis quand ce loyer est payé.'),false;
if(dp<de)return stepErr(3,'Cette date ne peut pas précéder la prise d\'effet du loyer de référence ('+fmtDate(de)+').'),false;
if(dp>dc)return stepErr(3,'Cette date ne peut pas être postérieure à la date du calcul.'),false;
if(dc<de)return stepErr(3,'La date du calcul doit être postérieure à la prise d\'effet du loyer.'),false}
if(s===4){const profil=document.getElementById('profil_utilisateur').value,nom=document.getElementById('nom').value.trim(),prenom=document.getElementById('prenom').value.trim(),tel=document.getElementById('telephone').value.trim(),email=document.getElementById('email').value.trim().toLowerCase();
if(!profil)return stepErr(4,'Sélectionnez votre profil.'),false;
if(!nom||!prenom||!tel||!email)return stepErr(4,'Tous les champs sont obligatoires.'),false;
const t=tel.replace(/[\s.\-()]/g,'').replace(/^\+33/,'0').replace(/^0033/,'0');
if(!/^0[1-9]\d{8}$/.test(t)||/^0(\d)\1{8}$/.test(t)||t==='0612345678')return stepErr(4,'Numéro de téléphone invalide : 10 chiffres attendus, par exemple 06 12 34 56 78.'),false;
if(!/^[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(email))return stepErr(4,'Adresse email invalide, par exemple prenom.nom@domaine.fr.'),false;
if(/(yopmail|mailinator|guerrillamail|10minutemail|temp-?mail|jetable|trashmail|maildrop)\./.test(email))return stepErr(4,'Les adresses email temporaires ne sont pas acceptées.'),false}
return true}

function lireDonnees(){return{dateEffet:parseDate(document.getElementById('date_effet').value),loyerRef:num('loyer_ref'),indice:radio('indice'),
refQ:qi(+document.getElementById('ref_annee').value,+document.getElementById('ref_trim').value),periode:+radio('periode'),
sens:radio('sens'),tunnel:num('tunnel_pct'),jeu:radio('jeu'),dateDemande:parseDate(document.getElementById('date_demande').value),
pme:radio('indice')==='ILC'&&radio('pme')==='oui',loyerPaye:num('loyer_paye'),datePaye:parseDate(document.getElementById('date_paye').value),
terme:+radio('terme'),dateCalc:parseDate(document.getElementById('date_calcul').value)||today()}}
function lireContact(){return{profil_utilisateur:document.getElementById('profil_utilisateur').value,nom:document.getElementById('nom').value.trim(),
prenom:document.getElementById('prenom').value.trim(),telephone:document.getElementById('telephone').value.trim(),email:document.getElementById('email').value.trim().toLowerCase()}}

function calculate(){if(!validateStep(4))return;const btn=document.getElementById('btn-calculate');btn.disabled=true;
const d=lireDonnees(),c=lireContact(),R=calculer(d),A=controles(d,R);resultat={d,c,R,A};
sendLead(c,d,R);renderResults();btn.disabled=false}

function renderResults(){const{d,c,R,A}=resultat;
const ecartAn=R.loyerDu-d.loyerPaye;
const sensLbl=R.exigible>=0?'Rattrapage exigible par le bailleur':'Trop-payé à restituer au locataire';
document.getElementById('summary').innerHTML=
'<div class="kpi"><div class="k-label">Loyer annuel dû au '+fmtDate(d.dateCalc)+'</div><div class="k-value">'+euro(R.loyerDu)+'</div><div class="k-sub">HT hors charges · '+pct(R.variationTotale)+' depuis le '+fmtDate(d.dateEffet)+'</div></div>'+
'<div class="kpi"><div class="k-label">Écart avec le loyer payé</div><div class="k-value">'+(ecartAn>=0?'+':'−')+euro(Math.abs(ecartAn))+'</div><div class="k-sub">par an, sur la base de '+euro(d.loyerPaye)+' payés</div></div>'+
'<div class="kpi hl"><div class="k-label">'+sensLbl+'</div><div class="k-value">'+euro(Math.abs(R.exigible))+'</div><div class="k-sub">échéances depuis le '+fmtDate(R.limite)+(R.prescrit>0.5?' · '+euro(R.prescrit)+' prescrits':'')+'</div></div>';
document.getElementById('alerts').innerHTML=A.map(a=>'<div class="alert alert-'+(a.niv==='info'?'warning':a.niv)+'"><strong>'+a.t+'</strong>'+a.m+'</div>').join('');
const tb=document.querySelector('#table-index tbody');let h='<tr><td>'+fmtDate(d.dateEffet)+'</td><td>'+d.indice+' '+qLabel(d.refQ)+' · '+fr(idx(d.indice,d.refQ),d.indice==='ICC'?0:2)+'</td><td class="num">base</td><td class="num">'+euro(d.loyerRef,true)+'</td></tr>';
R.ev.forEach(e=>{const pills=e.flags.map(f=>' <span class="pill pill-cap">'+(f==='bouclier'?'Bouclier 3,5 %':'Tunnel')+'</span>').join('');
h+='<tr><td>'+fmtDate(e.date)+'</td><td>'+d.indice+' '+qLabel(e.comp)+' · '+fr(e.valeur,d.indice==='ICC'?0:2)+pills+'</td><td class="num '+(e.variation>=0?'pos':'neg')+'">'+pct(e.variation)+'</td><td class="num">'+euro(e.loyer,true)+'</td></tr>'});
tb.innerHTML=h;
document.getElementById('table-note').textContent='Méthode : loyer de référence multiplié par la variation de l\'indice du même trimestre, à '+(d.periode===1?'un an':'trois ans')+' d\'écart. '+(R.ev.some(e=>e.flags.length)?'Les plafonds sont appliqués année par année puis chaînés. ':'')+'Montants arrondis au centime.';
const tr=document.querySelector('#table-ratt tbody');let t='',sd=0,sp=0,se=0;
R.annees.forEach(l=>{sd+=l.du;sp+=l.paye;se+=l.ecart;t+='<tr class="'+(l.prescrit?'old':'')+'"><td>'+l.annee+'</td><td class="num">'+euro(l.du)+'</td><td class="num">'+euro(l.paye)+'</td><td class="num '+(l.ecart>0.5?'pos':l.ecart<-0.5?'neg':'')+'">'+(l.ecart>=0?'+':'−')+euro(Math.abs(l.ecart))+'</td><td>'+(l.prescrit?'<span class="pill pill-old">Prescrit</span>':'<span class="pill pill-ok">Exigible</span>')+'</td></tr>'});
t+='<tr class="total"><td>Total non prescrit</td><td></td><td></td><td class="num">'+(R.exigible>=0?'+':'−')+euro(Math.abs(R.exigible))+'</td><td></td></tr>';
tr.innerHTML=t;
switchRole(['bailleur','gestionnaire'].includes(c.profil_utilisateur)?'bailleur':'preneur');
document.querySelectorAll('#simu-index .step').forEach(s=>s.classList.remove('active'));
document.getElementById('results').hidden=false;document.getElementById('results').classList.add('active');
document.querySelectorAll('#simu-index .progress-step').forEach(p=>{p.classList.remove('active');p.classList.add('completed')});scrollToSim()}

// ---------- Textes ----------
function recapIndexations(d,R){return R.ev.map(e=>'- '+fmtDate(e.date)+' : '+d.indice+' du '+qLabel(e.comp)+' ('+fr(e.valeur,d.indice==='ICC'?0:2)+'), '+pct(e.variation)+', loyer annuel '+euro(e.loyer,true)+' HT'+(e.flags.includes('bouclier')?' (plafonné à 3,5 %)':'')).join('\n')||'- Aucune date d\'indexation échue.'}
function pointsControle(A){return A.length?A.map(a=>'⚠ '+a.t+' : '+a.m).join('\n'):'Aucun point d\'alerte sur les éléments renseignés.'}
function genTexte(type){const{d,R,A}=resultat;const ref=d.indice+' du '+qLabel(d.refQ)+' ('+fr(idx(d.indice,d.refQ),d.indice==='ICC'?0:2)+')';
const du=R.exigible>0.5,trop=R.exigible<-0.5;
const base='Loyer de référence : '+euro(d.loyerRef,true)+' HT par an au '+fmtDate(d.dateEffet)+', indice de base '+ref+'.\nIndexation '+(d.periode===1?'annuelle':'triennale')+' sur l\''+NOM_INDICE[d.indice]+'.\nLoyer indexé dû au '+fmtDate(d.dateCalc)+' : '+euro(R.loyerDu,true)+' HT par an.\nLoyer payé depuis le '+fmtDate(d.datePaye)+' : '+euro(d.loyerPaye,true)+' HT par an.';
if(type==='analyse_p')return 'INDEXATION DU LOYER - ANALYSE CÔTÉ LOCATAIRE\n\n'+base+'\n\n'+
(du?'Le bailleur peut réclamer '+euro(R.exigible,true)+' au titre des échéances non prescrites, depuis le '+fmtDate(R.limite)+'.':trop?'Vous avez payé '+euro(-R.exigible,true)+' de trop sur les échéances non prescrites.':'Le loyer payé correspond au loyer indexé.')+
(R.prescrit>0.5?'\n'+euro(R.prescrit,true)+' sont prescrits et ne peuvent plus être réclamés.':'')+
'\n\nIndexations successives :\n'+recapIndexations(d,R)+'\n\nPoints de contrôle :\n'+pointsControle(A)+
'\n\nAvant de répondre au bailleur :\n- Ne reconnaissez pas la dette par écrit tant que le calcul n\'est pas vérifié : une reconnaissance interrompt la prescription (article 2240 du code civil).\n- Demandez le détail du calcul, les indices retenus et la date de chaque indexation.\n- Vérifiez la rédaction exacte de la clause : sens de la variation, indice de base, jeu automatique ou sur demande.\n- Un commandement de payer visant la clause résolutoire laisse un mois pour régler (article L. 145-41 du code de commerce). Des délais de paiement peuvent être demandés au juge (article 1343-5 du code civil).\n\nPièces à réunir : le bail et ses avenants, les avis d\'échéance depuis le '+fmtDate(d.datePaye)+', les courriers du bailleur sur le loyer.';
if(type==='courrier_p'){if(trop||d.sens==='hausse')return 'Objet : Indexation du loyer - demande de régularisation\n\nMadame, Monsieur,\n\nJe suis titulaire du bail commercial portant sur les locaux que vous me louez, dont le loyer a été fixé à '+euro(d.loyerRef,true)+' HT par an à compter du '+fmtDate(d.dateEffet)+'.\n\n'+
(d.sens==='hausse'?'La clause d\'indexation du bail ne joue qu\'à la hausse. Une telle stipulation est réputée non écrite (Cass. 3e civ., 12 janv. 2022, n° 21-11.169). L\'indice doit donc s\'appliquer dans les deux sens.\n\n':'')+
'Selon mon calcul, fondé sur l\''+NOM_INDICE[d.indice]+', le loyer dû au '+fmtDate(d.dateCalc)+' s\'établit à '+euro(R.loyerDu,true)+' HT par an. '+(trop?'Sur les cinq dernières années, j\'ai réglé '+euro(-R.exigible,true)+' de plus que le loyer dû.':'')+'\n\nIndexations retenues :\n'+recapIndexations(d,R)+'\n\nJe vous remercie de bien vouloir régulariser la situation'+(trop?' et me restituer cette somme':'')+', ou de me communiquer votre propre calcul, avec les indices retenus, dans un délai de trente jours.\n\nJe vous prie d\'agréer, Madame, Monsieur, mes salutations distinguées.';
return 'Objet : Indexation du loyer - demande de décompte\n\nMadame, Monsieur,\n\nJe suis titulaire du bail commercial portant sur les locaux que vous me louez, dont le loyer a été fixé à '+euro(d.loyerRef,true)+' HT par an à compter du '+fmtDate(d.dateEffet)+'.\n\nAfin de vérifier l\'application de la clause d\'indexation, je vous remercie de me communiquer un décompte détaillé : date de chaque indexation, indices comparés et loyer qui en résulte.\n\nÀ réception, je reviendrai vers vous sur les modalités de régularisation éventuelle.\n\nLe présent courrier ne vaut pas reconnaissance d\'une somme due.\n\nJe vous prie d\'agréer, Madame, Monsieur, mes salutations distinguées.'}
if(type==='analyse_b')return 'INDEXATION DU LOYER - ANALYSE CÔTÉ BAILLEUR\n\n'+base+'\n\n'+
(du?'Rappel exigible : '+euro(R.exigible,true)+' HT, sur les échéances postérieures au '+fmtDate(R.limite)+'.':trop?'Attention : le loyer perçu dépasse le loyer indexé de '+euro(-R.exigible,true)+' sur cinq ans. Le locataire peut en demander la restitution.':'Le loyer perçu correspond au loyer indexé.')+
(R.prescrit>0.5?'\nPrescrit : '+euro(R.prescrit,true)+'. Chaque échéance se prescrit par cinq ans (article 2224 du code civil) : chaque mois d\'attente fait perdre une échéance.':'')+
'\n\nIndexations successives :\n'+recapIndexations(d,R)+'\n\nPoints de contrôle :\n'+pointsControle(A)+
'\n\nPour sécuriser la demande :\n- Adressez-la par lettre recommandée avec avis de réception ou par commissaire de justice. La mise en demeure fait courir les intérêts au taux légal (article 1344-1 du code civil).\n- Seule une demande en justice, une mesure d\'exécution ou une reconnaissance du locataire interrompt la prescription (articles 2240 à 2244 du code civil). Un simple courrier ne l\'interrompt pas.\n- Joignez le détail des indices : un décompte vérifiable limite la contestation.\n- Un échéancier amiable évite souvent le contentieux.'+(d.sens==='hausse'?'\n- Votre clause ne joue qu\'à la hausse : elle est exposée. Ne réclamez pas plus que l\'application de l\'indice dans les deux sens.':'');
return 'Objet : Application de la clause d\'indexation - rappel de loyers\n\nLettre recommandée avec avis de réception\n\nMadame, Monsieur,\n\nLe bail commercial qui nous lie stipule une indexation '+(d.periode===1?'annuelle':'triennale')+' du loyer sur l\''+NOM_INDICE[d.indice]+'. Le loyer a été fixé à '+euro(d.loyerRef,true)+' HT par an à compter du '+fmtDate(d.dateEffet)+', sur la base de l\'indice du '+qLabel(d.refQ)+'.\n\n'+
(d.jeu==='demande'?'Par la présente, je vous demande l\'application de cette clause.\n\n':'')+
'En application de cette clause, le loyer s\'établit comme suit :\n'+recapIndexations(d,R)+'\n\nLe loyer dû à ce jour est donc de '+euro(R.loyerDu,true)+' HT par an, contre '+euro(d.loyerPaye,true)+' HT réglés actuellement.\n\n'+
(du?'Le rappel dû au titre des échéances échues depuis le '+fmtDate(R.limite)+' s\'élève à '+euro(R.exigible,true)+' HT, TVA en sus le cas échéant.\n\nJe vous remercie de bien vouloir régler cette somme dans un délai de trente jours et d\'appliquer le loyer indexé dès la prochaine échéance. Je reste ouvert à un échéancier si vous le souhaitez.':'Je vous remercie d\'appliquer le loyer indexé dès la prochaine échéance.')+
'\n\nJe vous prie d\'agréer, Madame, Monsieur, mes salutations distinguées.'}

function switchRole(role){currentRole=role;
document.querySelectorAll('#simu-index .narrative-role').forEach(r=>r.classList.toggle('active',r.dataset.role===role));
document.querySelectorAll('#simu-index .narrative-tabs').forEach(t=>t.hidden=t.dataset.role!==role);
switchNarrative(role==='bailleur'?'analyse_b':'analyse_p')}
function switchNarrative(type){currentType=type;
document.querySelectorAll('#simu-index .narrative-tab').forEach(t=>t.classList.toggle('active',t.dataset.type===type));
narrativeText=genTexte(type);document.getElementById('narrative-text').textContent=narrativeText}
const AVERTISSEMENT='---\nModèle indicatif généré par le simulateur d\'indexation de Louis Pinet, avocat des restaurateurs. Il ne constitue ni une consultation, ni un décompte opposable. À faire relire avant tout envoi.\nPrendre rendez-vous : '+CALENDLY_URL;
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
periode:d.periode,sens:d.sens,jeu:d.jeu,pme:d.pme,date_paye:isoDate(d.datePaye),loyer_du:R.loyerDu,rattrapage_exigible:R.exigible,montant_prescrit:R.prescrit};
try{fetch(LEAD_ENDPOINT,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(corps),keepalive:true}).catch(()=>{})}catch(e){}}
function resetSim(){try{localStorage.removeItem('simu_index')}catch(e){}location.reload()}
