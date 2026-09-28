# Recalcul indépendant (Python, Decimal) — ne réutilise pas simu.js
import json,re
from decimal import Decimal as D, ROUND_HALF_UP
from datetime import date
src=open('indices.js',encoding='utf-8').read()
def serie(nom):
    m=re.search(nom+r":\{([^}]*)\}",src);return {k:D(v) for k,v in re.findall(r"'(\d{4}-T\d)':([\d.]+)",m.group(1))}
IND={n:serie(n) for n in('ILC','ILAT','ICC')}
def q(y,t):return f"{y}-T{t}"
def shift(key,years):y,t=key.split('-T');return q(int(y)+years,int(t))
def r2(x):return x.quantize(D('0.01'),ROUND_HALF_UP)
def inwin(key):y,t=map(int,key.split('-T'));i=y*4+t-1;return 2022*4+1<=i<=2024*4
def scen(eff,loyer,ind,ref,per,pme,calc,paye=None,datepaye=None,terme=1):
    ev=[];L=D(loyer);k=1
    while True:
        d=date(eff.year+k*per,eff.month,eff.day)
        if d>calc:break
        comp=shift(ref,k*per)
        if comp not in IND[ind]:break
        r=D(1)
        for j in range(per):
            a=IND[ind][shift(ref,(k-1)*per+j)];b=IND[ind][shift(ref,(k-1)*per+j+1)]
            x=b/a
            if ind=='ILC' and pme and inwin(shift(ref,(k-1)*per+j+1)) and x>D('1.035'):x=D('1.035')
            r*=x
        L=r2(L*r);ev.append((d,L));k+=1
    def du(t):
        v=D(loyer)
        for d,l in ev:
            if d<=t:v=l
        return v
    paye=D(paye if paye else loyer);datepaye=datepaye or eff
    lim=date(calc.year-5,calc.month,calc.day)
    ex=D(0);pr=D(0)
    y,m=eff.year,eff.month
    while date(y,m,1)<=calc:
        e=date(y,m,1)
        if e>=eff:
            due=du(e)*terme/12  # loyers alignés sur le 1er du mois ici
            pay=(paye if e>=datepaye else du(e))*terme/12
            if e<lim:pr+=due-pay
            else:ex+=due-pay
        m+=terme
        while m>12:m-=12;y+=1
    return ev,r2(ex),r2(pr)
cas={
 'exemple':dict(eff=date(2020,7,1),loyer=24000,ind='ILC',ref='2020-T1',per=1,pme=True,calc=date(2026,9,28)),
 'sans_pme':dict(eff=date(2020,7,1),loyer=24000,ind='ILC',ref='2020-T1',per=1,pme=False,calc=date(2026,9,28)),
 'triennal_icc':dict(eff=date(2017,4,1),loyer=18000,ind='ICC',ref='2016-T4',per=3,pme=False,calc=date(2026,9,28)),
 'ilat_trim':dict(eff=date(2019,1,1),loyer=40000,ind='ILAT',ref='2018-T3',per=1,pme=False,calc=date(2026,9,28),terme=3),
 'paye_partiel':dict(eff=date(2018,10,1),loyer=30000,ind='ILC',ref='2018-T2',per=1,pme=True,calc=date(2026,9,28),paye=31200,datepaye=date(2021,10,1)),
}
out={}
for n,c in cas.items():
    ev,ex,pr=scen(**c);out[n]={'loyers':[str(l) for _,l in ev],'exigible':str(ex),'prescrit':str(pr)}
    print(n,'| loyers:',', '.join(str(l) for _,l in ev),'| exigible',ex,'| prescrit',pr)
json.dump(out,open('tests/verif.json','w'))
