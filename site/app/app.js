"use strict";
/* =====================================================================
   Retoma — aplicação navegável (MVP)
   Camadas:  util → store (adaptador local) → services (leads, follow-ups,
   mensagens, métricas, clínica, auth) → UI.
   Os services expõem a mesma interface que terá a versão Supabase; o
   escopo por clínica (tenant) aplicado aqui espelha as políticas RLS.
   ===================================================================== */

/* ---------------- util ---------------- */
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad=n=>String(n).padStart(2,"0");
const uid=()=>(crypto.randomUUID?crypto.randomUUID():"id-"+Date.now().toString(36)+Math.random().toString(36).slice(2));
const norm=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
const digits=s=>String(s||"").replace(/\D/g,"");
const BRL=new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"});
const BRL0=new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:0});
const money=v=>v==null?"—":BRL.format(v);
const money0=v=>BRL0.format(v||0);
const MES=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const isoDate=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const localDT=d=>`${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const nowDT=()=>{const d=new Date();return localDT(d)+":"+pad(d.getSeconds());};
function dtOff(days,h=10,m=0){const d=new Date();d.setDate(d.getDate()+days);d.setHours(h,m,0,0);return localDT(d);}
function parseDT(s){const[dp,tp="00:00"]=String(s).split("T");const[y,mo,da]=dp.split("-").map(Number);const[h,mi]=tp.split(":").map(Number);return new Date(y,mo-1,da,h||0,mi||0);}
function startToday(){const d=new Date();d.setHours(0,0,0,0);return d;}
function dayDiff(s){const a=parseDT(s);a.setHours(0,0,0,0);return Math.round((a-startToday())/864e5);}
function fmtDate(s){if(!s)return"—";const d=parseDT(s);const y=d.getFullYear()!==new Date().getFullYear()?" "+d.getFullYear():"";return`${d.getDate()} ${MES[d.getMonth()]}${y}`;}
const fmtTime=s=>String(s).slice(11,16);
const fmtDT=s=>s?`${fmtDate(s)}, ${fmtTime(s)}`:"—";
function fmtPhone(v){const d=digits(v);if(d.length===11)return`(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;if(d.length===10)return`(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;return d;}
function maskPhone(v){const d=digits(v).slice(0,11);if(!d)return"";if(d.length<=2)return`(${d}`;if(d.length<=6)return`(${d.slice(0,2)}) ${d.slice(2)}`;if(d.length<=10)return`(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;return`(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;}
function parseMoney(v){const s=String(v||"").replace(/[^\d,]/g,"").replace(",",".");if(!s)return null;const n=parseFloat(s);return isNaN(n)?null:Math.round(n*100)/100;}
const moneyInput=v=>v==null?"":v.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const initials=n=>String(n||"?").trim().split(/\s+/).slice(0,2).map(p=>p[0]).join("").toUpperCase();
function greeting(){const h=new Date().getHours();return h<12?"Bom dia":h<18?"Boa tarde":"Boa noite";}
function waLink(phone,text){let d=digits(phone);if(!(d.startsWith("55")&&d.length>=12))d="55"+d;return`https://wa.me/${d}?text=${encodeURIComponent(text)}`;}

/* ---------------- domínio ---------------- */
const STAGES=[
  {id:"novo",label:"Novo"},
  {id:"orcamento",label:"Orçamento enviado"},
  {id:"aguardando",label:"Aguardando retorno"},
  {id:"negociacao",label:"Em negociação"},
  {id:"convertido",label:"Convertido"},
  {id:"perdido",label:"Perdido"}];
const STAGE_IDS=STAGES.map(s=>s.id);
const OPEN=["orcamento","aguardando","negociacao"];
const CLOSED=["convertido","perdido"];
const stageLabel=id=>(STAGES.find(s=>s.id===id)||{}).label||id;
const CONSENT_SOURCES=["Formulário de avaliação","Conversa iniciada pelo paciente no WhatsApp","Autorização verbal registrada no atendimento","Outro"];
const VARS=[
  {k:"nome",d:"Primeiro nome do lead"},
  {k:"nome_completo",d:"Nome completo"},
  {k:"servico",d:"Serviço do orçamento"},
  {k:"valor",d:"Valor do orçamento"},
  {k:"clinica",d:"Nome da clínica"},
  {k:"atendente",d:"Quem assina as mensagens"}];
const SERVICES_DEFAULT=["Toxina botulínica","Preenchimento labial","Harmonização facial","Bioestimulador de colágeno","Fios de PDO","Limpeza de pele","Peeling químico","Microagulhamento","Depilação a laser","Criolipólise"];
const ACTION_LABEL={copiada:"Copiada",whatsapp:"Link do WhatsApp acionado"};

function renderTemplate(body,lead,clinic){
  const map={nome:(lead.name||"").trim().split(/\s+/)[0],nome_completo:lead.name,servico:lead.service,valor:lead.value?money(lead.value):"",clinica:clinic.name,atendente:clinic.attendant||""};
  const missing=new Set();
  const text=String(body).replace(/\{\{\s*([a-z_]+)\s*\}\}/g,(m,k)=>{if(!map[k]){missing.add(k);return m;}return map[k];});
  return{text,missing:[...missing]};
}

/* ---------------- store (adaptador local de demonstração) ---------------- */
const STORE_KEY="retoma:v1", SESSION_KEY="retoma:session", DEMO_ID="clinica-demo";
let db, session=null;
const emptyDB=()=>({clinics:[],users:[],leads:[],followups:[],templates:[],messages:[]});
function loadDB(){
  try{const raw=localStorage.getItem(STORE_KEY);if(raw){db=JSON.parse(raw);}}catch(e){}
  if(!db||!db.clinics){db=emptyDB();}
  if(!db.clinics.some(c=>c.id===DEMO_ID))seedDemo();
}
function saveDB(){try{localStorage.setItem(STORE_KEY,JSON.stringify(db));}catch(e){}}
function saveSession(){try{session&&session.mode==="demo"?localStorage.setItem(SESSION_KEY,JSON.stringify(session)):localStorage.removeItem(SESSION_KEY);}catch(e){}}

function defaultTemplates(cid){return[
  {id:uid(),clinic_id:cid,name:"Primeiro retorno",body:"Olá, {{nome}}! Aqui é {{atendente}}, da {{clinica}}. Passando para saber se ficou alguma dúvida sobre o orçamento de {{servico}}. Posso te ajudar com algo?"},
  {id:uid(),clinic_id:cid,name:"Condições de pagamento",body:"Oi, {{nome}}, tudo bem? O orçamento de {{servico}} ficou em {{valor}} e temos opções de parcelamento que podem facilitar. Quer que eu te explique como funciona?"},
  {id:uid(),clinic_id:cid,name:"Horários da semana",body:"Olá, {{nome}}! Abrimos alguns horários para {{servico}} nesta semana aqui na {{clinica}}. Se quiser, reservo um para você."},
  {id:uid(),clinic_id:cid,name:"Último contato",body:"Oi, {{nome}}! Não quero ser insistente: se agora não for o momento para {{servico}}, tudo bem. Fico à disposição quando quiser retomar. {{atendente}}, {{clinica}}."}];}

const DEMO_LEADS=[
 {n:"Mariana Albuquerque",p:"85990000101",s:"Bioestimulador de colágeno",v:2400,st:"aguardando",c:-9,ok:1,fu:[{d:0,h:10,m:30,note:"Retomar dúvida sobre número de sessões"}],done:[{d:-4}],msg:[{d:-4,t:0,a:"copiada"}]},
 {n:"Juliana Teixeira",p:"85990000102",s:"Toxina botulínica",v:1350,st:"orcamento",c:-3,ok:1,src:1,fu:[{d:1,h:14,note:"Primeiro retorno após envio do orçamento"}]},
 {n:"Camila Bezerra",p:"85990000103",s:"Preenchimento labial",v:1800,st:"negociacao",c:-12,ok:1,fu:[{d:-2,h:11,note:"Pediu parcelamento em 6x"}],done:[{d:-6}],msg:[{d:-6,t:1,a:"whatsapp"}]},
 {n:"Patrícia Mendes",p:"85990000104",s:"Harmonização facial",v:4900,st:"aguardando",c:-15,ok:1,fu:[{d:-1,h:16,note:"Confirmar se decidiu sobre o valor"}],done:[{d:-8}],msg:[{d:-8,t:0,a:"copiada"}]},
 {n:"Renata Holanda",p:"85990000105",s:"Depilação a laser",v:null,st:"novo",c:-1,ok:0,notes:"Chegou pelo Instagram. Avaliação ainda não feita."},
 {n:"Larissa Gurgel",p:"85990000106",s:"Microagulhamento",v:650,st:"orcamento",c:-5,ok:1,fu:[{d:2,h:9,m:30}]},
 {n:"Débora Fontenele",p:"85990000107",s:"Bioestimulador de colágeno",v:3600,st:"negociacao",c:-20,ok:1,fu:[{d:4,h:15,note:"Enviar condição para fechar 2 sessões"}],done:[{d:-10},{d:-3}],msg:[{d:-3,t:1,a:"whatsapp"}]},
 {n:"Isabela Viana",p:"85990000108",s:"Preenchimento labial",v:1800,st:"aguardando",c:-7,ok:0,notes:"Autorização para mensagens ainda não registrada."},
 {n:"Gabriela Nunes",p:"85990000109",s:"Toxina botulínica",v:null,st:"novo",c:0,ok:1,fu:[{d:0,h:17,note:"Enviar orçamento após avaliação"}]},
 {n:"Sabrina Lopes",p:"85990000110",s:"Limpeza de pele",v:280,st:"orcamento",c:-6,ok:1},
 {n:"Fernanda Pinheiro",p:"85990000111",s:"Criolipólise",v:2100,st:"convertido",c:-25,u:-14,ok:1,done:[{d:-18}],msg:[{d:-18,t:0,a:"copiada"}]},
 {n:"Beatriz Sales",p:"85990000112",s:"Toxina botulínica",v:1350,st:"convertido",c:-16,u:-6,ok:1,done:[{d:-9}],msg:[{d:-9,t:2,a:"whatsapp"}]},
 {n:"Aline Rocha",p:"85990000113",s:"Limpeza de pele",v:280,st:"convertido",c:-4,u:-4,ok:1},
 {n:"Tatiane Moura",p:"85990000114",s:"Fios de PDO",v:3200,st:"convertido",c:-30,u:-11,ok:1,done:[{d:-22},{d:-15}],msg:[{d:-15,t:1,a:"whatsapp"}]},
 {n:"Vanessa Lima",p:"85990000115",s:"Harmonização facial",v:4200,st:"perdido",c:-28,u:-10,ok:1,notes:"Optou por adiar para o próximo ano.",done:[{d:-20}],msg:[{d:-12,t:3,a:"copiada"}]},
 {n:"Priscila Castro",p:"85990000116",s:"Peeling químico",v:450,st:"perdido",c:-19,u:-12,ok:0}];

function seedDemo(){
  const cid=DEMO_ID;
  ["leads","followups","templates","messages"].forEach(k=>db[k]=db[k].filter(r=>r.clinic_id!==cid));
  db.clinics=db.clinics.filter(c=>c.id!==cid);db.users=db.users.filter(u=>u.clinic_id!==cid);
  const clinic={id:cid,name:"Clínica Lumiar",phone:"85940000000",attendant:"Carla",services:SERVICES_DEFAULT.slice(),created_at:dtOff(-60),demo:true};
  db.clinics.push(clinic);
  db.users.push({id:"demo-user",clinic_id:cid,name:"Carla (demonstração)",email:"demo@retoma.app",pass:null});
  const T=defaultTemplates(cid);db.templates.push(...T);
  DEMO_LEADS.forEach((x,i)=>{
    const lead={id:"demo-lead-"+(i+1),clinic_id:cid,name:x.n,phone:x.p,service:x.s,value:x.v,stage:x.st,notes:x.notes||"",
      consent:!!x.ok,consent_source:x.ok?CONSENT_SOURCES[x.src||0]:null,consent_at:x.ok?dtOff(x.c,9):null,
      created_at:dtOff(x.c,9),updated_at:dtOff(x.u??x.c,15),converted_at:x.st==="convertido"?dtOff(x.u,15):null,lost_at:x.st==="perdido"?dtOff(x.u,15):null,demo:true};
    db.leads.push(lead);
    (x.fu||[]).forEach(f=>db.followups.push({id:uid(),clinic_id:cid,lead_id:lead.id,due_at:dtOff(f.d,f.h??10,f.m??0),note:f.note||"",status:"pendente",history:[],created_at:dtOff(x.c,9)}));
    (x.done||[]).forEach(f=>db.followups.push({id:uid(),clinic_id:cid,lead_id:lead.id,due_at:dtOff(f.d,11),note:"Retorno do orçamento",status:"concluido",completed_at:dtOff(f.d,11,20),history:[],created_at:dtOff(x.c,9)}));
    (x.msg||[]).forEach(m=>{const t=T[m.t];db.messages.push({id:uid(),clinic_id:cid,lead_id:lead.id,template_id:t.id,template_name:t.name,body:renderTemplate(t.body,lead,clinic).text,action:m.a,delivery:"nao_confirmada",by:"Carla (demonstração)",created_at:dtOff(m.d,11,5)});});
  });
  saveDB();
}

/* ---------------- camada de chamada (latência, falhas, isolamento) ---------------- */
const dev={failNext:false};
class ValidationError extends Error{constructor(fields){super("Revise os campos destacados.");this.fields=fields;}}
async function call(fn){
  await new Promise(r=>setTimeout(r,180+Math.random()*240));
  if(dev.failNext){dev.failNext=false;throw new Error("Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.");}
  const r=fn();saveDB();
  return r===undefined?r:structuredClone(r);
}
function tenant(){if(!session)throw new Error("Sua sessão terminou. Entre novamente.");return session.clinicId;}
const own=arr=>{const c=tenant();return arr.filter(r=>r.clinic_id===c);};
const byDue=(a,b)=>a.due_at.localeCompare(b.due_at);
const findLead=id=>{const l=db.leads.find(l=>l.id===id&&l.clinic_id===tenant());if(!l)throw new Error("Lead não encontrado nesta clínica.");return l;};
const pendingOf=leadId=>db.followups.filter(f=>f.lead_id===leadId&&f.clinic_id===tenant()&&f.status==="pendente").sort(byDue);
function enrich(l){const p=pendingOf(l.id);return{...l,next_contact:p[0]?.due_at||null,pending_count:p.length};}
function leadBrief(id){const l=db.leads.find(l=>l.id===id);return l?{id:l.id,name:l.name,service:l.service,value:l.value,stage:l.stage,phone:l.phone,consent:l.consent}:null;}
function applyStage(lead,prev,now){
  if(prev===lead.stage)return 0;
  lead.converted_at=lead.stage==="convertido"?now:null;
  lead.lost_at=lead.stage==="perdido"?now:null;
  if(!CLOSED.includes(lead.stage))return 0;
  const p=pendingOf(lead.id);p.forEach(f=>{f.status="cancelado";f.cancelled_at=now;f.cancel_reason=`Lead marcado como ${stageLabel(lead.stage).toLowerCase()}`;});
  return p.length;
}

/* ---------------- regras compartilhadas (validação, filtros, indicadores) ---------------- */
const hasErrs=e=>Object.keys(e).length>0;
function applyLeadFilters(L,f={}){
  if(f.q){const q=norm(f.q),qd=digits(f.q);L=L.filter(l=>norm(l.name).includes(q)||norm(l.service).includes(q)||(qd.length>=3&&l.phone.includes(qd)));}
  if(f.stage)L=L.filter(l=>l.stage===f.stage);
  if(f.service)L=L.filter(l=>l.service===f.service);
  if(f.consent)L=L.filter(l=>f.consent==="sim"?l.consent:!l.consent);
  if(f.contact)L=L.filter(l=>{const n=l.next_contact?dayDiff(l.next_contact):null;
    switch(f.contact){case"atrasado":return n!==null&&n<0;case"hoje":return n===0;case"semana":return n!==null&&n>=0&&n<=7;case"sem":return n===null&&!CLOSED.includes(l.stage);}return true;});
  return L.sort((a,b)=>{if(a.next_contact&&b.next_contact)return a.next_contact.localeCompare(b.next_contact);if(a.next_contact)return-1;if(b.next_contact)return 1;return String(b.updated_at).localeCompare(String(a.updated_at));});
}
function validateLeadInput(d,cur){
  const errs={};const name=String(d.name||"").trim(),phone=digits(d.phone),service=String(d.service||"").trim();
  if(name.length<2)errs.name="Informe o nome do lead.";
  if(phone.length<10||phone.length>11)errs.phone="Informe o telefone com DDD (10 ou 11 dígitos).";
  if(!service)errs.service="Informe o serviço de interesse.";
  if(!STAGE_IDS.includes(d.stage))errs.stage="Escolha uma etapa.";
  if(d.value!=null&&d.value<0)errs.value="O valor não pode ser negativo.";
  if(d.stage!=="novo"&&!(d.value>0))errs.value="Informe o valor do orçamento para esta etapa.";
  let dt=null;
  if(d.next_date){dt=`${d.next_date}T${d.next_time||"09:00"}`;
    if(isNaN(parseDT(dt).getTime()))errs.next_date="Data inválida.";
    else if(CLOSED.includes(d.stage))errs.next_date="Leads convertidos ou perdidos não têm próximo contato.";
    else if((!cur||cur.due_at!==dt)&&parseDT(dt)<startToday())errs.next_date="Escolha uma data a partir de hoje.";}
  if(d.consent&&!d.consent_source)errs.consent_source="Informe como a autorização foi obtida.";
  return{errs,name,phone,service,dt};
}
function validateClinicInput(d){const errs={};
  if(String(d.name||"").trim().length<2)errs.name="Informe o nome da clínica.";
  if(d.phone&&![10,11].includes(digits(d.phone).length))errs.phone="Use DDD + número (10 ou 11 dígitos).";
  if(!String(d.attendant||"").trim())errs.attendant="Informe quem assina as mensagens.";
  return errs;}
function validateTemplateInput(d){const errs={};const name=String(d.name||"").trim(),body=String(d.body||"").trim();
  if(name.length<2)errs.name="Dê um nome ao modelo.";
  if(body.length<10)errs.body="Escreva a mensagem (mínimo de 10 caracteres).";
  const bad=[...body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map(m=>m[1]).filter(k=>!VARS.some(v=>v.k===k));
  if(bad.length)errs.body=`Variável desconhecida: {{${bad[0]}}}.`;
  return{errs,name,body};}
function validateFollowupDate(date,time,key="date"){const dt=date?`${date}T${time||"09:00"}`:null;
  if(!dt)return{err:{[key]:"Escolha a data do contato."}};
  if(parseDT(dt)<startToday())return{err:{[key]:"Escolha uma data a partir de hoje."}};
  return{dt};}
function sortFus(F,status){
  if(status==="pendente")return F.sort(byDue);
  return F.sort((a,b)=>String(b.completed_at||b.cancelled_at||b.due_at).localeCompare(String(a.completed_at||a.cancelled_at||a.due_at)));}
function sortLeadFus(F){const o={pendente:0,concluido:1,cancelado:2};return F.sort((a,b)=>o[a.status]-o[b.status]||(a.status==="pendente"?byDue(a,b):byDue(b,a)));}
function computeDashboard(L,F,M){
  const byId=Object.fromEntries(L.map(l=>[l.id,l]));
  const brief=id=>{const l=byId[id];return l?{id:l.id,name:l.name,service:l.service,value:l.value,stage:l.stage,phone:l.phone,consent:l.consent}:null;};
  const sum=a=>a.reduce((s,l)=>s+(l.value||0),0);
  const open=L.filter(l=>OPEN.includes(l.stage));
  const pending=F.filter(f=>f.status==="pendente");
  const conv=L.filter(l=>l.stage==="convertido"),lost=L.filter(l=>l.stage==="perdido");
  const touched=id=>F.some(f=>f.lead_id===id&&f.status==="concluido")||M.some(m=>m.lead_id===id);
  const rec=conv.filter(l=>touched(l.id));
  const due=pending.filter(f=>dayDiff(f.due_at)<=0).sort(byDue).map(f=>({...f,lead:brief(f.lead_id)}));
  const stale=open.filter(l=>!pending.some(f=>f.lead_id===l.id)).sort((a,b)=>(b.value||0)-(a.value||0)).map(l=>({id:l.id,name:l.name,service:l.service,value:l.value,stage:l.stage}));
  return{total:L.length,openCount:open.length,openValue:sum(open),pending:pending.length,overdue:pending.filter(f=>dayDiff(f.due_at)<0).length,
    recovered:rec.length,recoveredValue:sum(rec),converted:conv.length,soldValue:sum(conv),
    closeRate:conv.length+lost.length?Math.round(conv.length/(conv.length+lost.length)*100):null,
    byStage:STAGES.map(s=>({...s,count:L.filter(l=>l.stage===s.id).length,value:sum(L.filter(l=>l.stage===s.id))})),due,stale};
}

/* =====================================================================
   Adaptador LOCAL — usado só na clínica de demonstração (dados fictícios
   guardados no navegador; nada vai para o banco real).
   ===================================================================== */
const local={
  clinic:{
    me:()=>call(()=>{const c=db.clinics.find(c=>c.id===tenant());if(!c)throw new Error("Clínica não encontrada.");const u=db.users.find(u=>u.id===session.userId);return{clinic:c,user:u?{name:u.name,email:u.email}:{name:"",email:""}};}),
    update:d=>call(()=>{const errs=validateClinicInput(d);if(hasErrs(errs))throw new ValidationError(errs);const c=db.clinics.find(c=>c.id===tenant());
      Object.assign(c,{name:d.name.trim(),phone:digits(d.phone),attendant:d.attendant.trim(),services:d.services});return c;})
  },
  leads:{
    list:(f={})=>call(()=>applyLeadFilters(own(db.leads).map(enrich),f)),
    get:id=>call(()=>enrich(findLead(id))),
    serviceOptions:()=>call(()=>{const c=db.clinics.find(c=>c.id===tenant());return[...new Set([...(c.services||[]),...own(db.leads).map(l=>l.service)])].sort((a,b)=>a.localeCompare(b,"pt-BR"));}),
    save:(id,d)=>call(()=>{
      const cid=tenant();const existing=id?findLead(id):null;const cur=existing?pendingOf(existing.id)[0]:null;
      const v=validateLeadInput(d,cur);
      if(!v.errs.phone&&db.leads.some(l=>l.clinic_id===cid&&l.phone===v.phone&&l.id!==id))v.errs.phone="Já existe um lead com este telefone.";
      if(hasErrs(v.errs))throw new ValidationError(v.errs);
      const now=nowDT();let lead=existing;
      if(!lead){lead={id:uid(),clinic_id:cid,created_at:now,demo:true,consent:false,stage:d.stage};db.leads.push(lead);}
      const prev=existing?existing.stage:d.stage,hadConsent=lead.consent;
      Object.assign(lead,{name:v.name,phone:v.phone,service:v.service,value:d.value,stage:d.stage,notes:String(d.notes||"").trim(),consent:!!d.consent,consent_source:d.consent?d.consent_source:null,updated_at:now});
      if(d.consent&&!hadConsent)lead.consent_at=now;if(!d.consent)lead.consent_at=null;
      if(!existing&&d.stage==="convertido")lead.converted_at=now;
      if(!existing&&d.stage==="perdido")lead.lost_at=now;
      const cancelled=existing?applyStage(lead,prev,now):0;
      if(v.dt&&!CLOSED.includes(d.stage)){
        if(cur){if(cur.due_at!==v.dt){cur.history.push({from:cur.due_at,to:v.dt,at:now});cur.due_at=v.dt;}}
        else db.followups.push({id:uid(),clinic_id:cid,lead_id:lead.id,due_at:v.dt,note:"Próximo contato definido no cadastro",status:"pendente",history:[],created_at:now});
      }
      return{lead:enrich(lead),cancelled,created:!existing};}),
    setStage:(id,stage)=>call(()=>{
      if(!STAGE_IDS.includes(stage))throw new Error("Etapa inválida.");
      const l=findLead(id);if(stage!=="novo"&&!(l.value>0))throw new Error("Informe o valor do orçamento antes de avançar este lead.");
      const prev=l.stage;l.stage=stage;const now=nowDT();l.updated_at=now;
      return{lead:enrich(l),cancelled:applyStage(l,prev,now)};})
  },
  fu:{
    list:status=>call(()=>{let F=own(db.followups);if(status)F=F.filter(f=>f.status===status);return sortFus(F.map(f=>({...f,lead:leadBrief(f.lead_id)})),status);}),
    forLead:id=>call(()=>{findLead(id);return sortLeadFus(own(db.followups).filter(f=>f.lead_id===id));}),
    counts:()=>call(()=>({due:own(db.followups).filter(f=>f.status==="pendente"&&dayDiff(f.due_at)<=0).length})),
    create:d=>call(()=>{const errs={};let lead=null;try{lead=d.lead_id?findLead(d.lead_id):null;}catch(e){}
      if(!lead)errs.lead_id="Escolha um lead.";else if(CLOSED.includes(lead.stage))errs.lead_id="Este lead já foi convertido ou perdido.";
      const v=validateFollowupDate(d.date,d.time);if(v.err)Object.assign(errs,v.err);
      if(hasErrs(errs))throw new ValidationError(errs);
      const f={id:uid(),clinic_id:tenant(),lead_id:lead.id,due_at:v.dt,note:String(d.note||"").trim(),status:"pendente",history:[],created_at:nowDT()};
      db.followups.push(f);return f;}),
    reschedule:(id,date,time)=>call(()=>{const f=db.followups.find(f=>f.id===id&&f.clinic_id===tenant());if(!f||f.status!=="pendente")throw new Error("Acompanhamento não está mais pendente.");
      const v=validateFollowupDate(date,time);if(v.err)throw new ValidationError(v.err);
      f.history.push({from:f.due_at,to:v.dt,at:nowDT()});f.due_at=v.dt;return f;}),
    cancel:id=>call(()=>{const f=db.followups.find(f=>f.id===id&&f.clinic_id===tenant());if(!f||f.status!=="pendente")throw new Error("Acompanhamento não está mais pendente.");f.status="cancelado";f.cancelled_at=nowDT();f.cancel_reason="Cancelado pela equipe";return f;}),
    complete:id=>call(()=>{const f=db.followups.find(f=>f.id===id&&f.clinic_id===tenant());if(!f||f.status!=="pendente")throw new Error("Acompanhamento não está mais pendente.");f.status="concluido";f.completed_at=nowDT();return f;})
  },
  msg:{
    templates:()=>call(()=>own(db.templates)),
    saveTemplate:(id,d)=>call(()=>{const v=validateTemplateInput(d);if(hasErrs(v.errs))throw new ValidationError(v.errs);
      if(id){const t=db.templates.find(t=>t.id===id&&t.clinic_id===tenant());if(!t)throw new Error("Modelo não encontrado.");Object.assign(t,{name:v.name,body:v.body});return t;}
      const t={id:uid(),clinic_id:tenant(),name:v.name,body:v.body};db.templates.push(t);return t;}),
    deleteTemplate:id=>call(()=>{const c=tenant();const i=db.templates.findIndex(t=>t.id===id&&t.clinic_id===c);if(i<0)throw new Error("Modelo não encontrado.");db.templates.splice(i,1);}),
    log:d=>call(()=>{const lead=findLead(d.lead_id);if(!lead.consent)throw new Error("Este lead não autorizou receber mensagens.");
      if(!["copiada","whatsapp"].includes(d.action))throw new Error("Ação inválida.");
      const u=db.users.find(u=>u.id===session.userId);
      const m={id:uid(),clinic_id:tenant(),lead_id:lead.id,template_id:d.template_id||null,template_name:d.template_name||"Mensagem livre",body:d.body,action:d.action,delivery:"nao_confirmada",by:u?u.name:"",created_at:nowDT()};
      db.messages.push(m);return m;}),
    list:(f={})=>call(()=>{let M=own(db.messages);
      if(f.lead_id)M=M.filter(m=>m.lead_id===f.lead_id);
      if(f.action)M=M.filter(m=>m.action===f.action);
      M=M.map(m=>({...m,lead:leadBrief(m.lead_id)}));
      if(f.q){const q=norm(f.q);M=M.filter(m=>norm(m.lead?.name).includes(q)||norm(m.body).includes(q)||norm(m.template_name).includes(q));}
      return M.sort((a,b)=>b.created_at.localeCompare(a.created_at));})
  },
  metrics:{dashboard:()=>call(()=>computeDashboard(own(db.leads),own(db.followups),own(db.messages)))}
};

/* =====================================================================
   Adaptador SUPABASE — contas reais. Usa só a chave pública (anon);
   o isolamento entre clínicas é feito pelas políticas RLS do banco.
   ===================================================================== */
const SB_URL="https://muhvgileqkvzysyflfaq.supabase.co";
const SB_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im11aHZnaWxlcWt2enlzeWZsZmFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzNDkzMzIsImV4cCI6MjEwNzkyNTMzMn0.8fUotYvkYI0-IWQDMJGsNpjqRs3oRSRLNEYhafzDduI";
const NET_MSG="Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.";
let _sb=null;
function sb(){if(!_sb){if(!window.supabase)throw new Error("O serviço de login não carregou. Recarregue a página.");_sb=window.supabase.createClient(SB_URL,SB_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});}return _sb;}
function mapErr(e){const m=String(e?.message||""),c=e?.code;
  if(c==="23505"&&/phone/.test(m))return new ValidationError({phone:"Já existe um lead com este telefone."});
  if(c==="42501"||/row-level security|permission denied/i.test(m))return new Error("Você não tem permissão para esta ação.");
  if(c==="PGRST116")return new Error("Registro não encontrado ou sem permissão para alterá-lo.");
  if(c==="23514"||c==="23502")return new Error("Alguns dados não passaram na validação do servidor. Revise e tente de novo.");
  if(/JWT|token/i.test(m))return new Error("Sua sessão expirou. Entre novamente.");
  if(/fetch|network/i.test(m))return new Error(NET_MSG);
  return new Error("Não foi possível concluir a operação. "+m);}
async function rq(q){
  if(dev.failNext){dev.failNext=false;await new Promise(r=>setTimeout(r,250));throw new Error(NET_MSG);}
  let r;try{r=await q;}catch(e){throw new Error(NET_MSG);}
  if(r.error)throw mapErr(r.error);return r.data;}
const fromDB=iso=>iso?localDT(new Date(iso)):null;
const fromDBs=iso=>{if(!iso)return null;const d=new Date(iso);return localDT(d)+":"+pad(d.getSeconds());};
const toDB=s=>parseDT(s).toISOString();
const numOrNull=v=>v==null?null:Number(v);
const mapClinic=r=>({id:r.id,name:r.name,phone:r.phone||"",attendant:r.attendant_name||"",services:r.services||[],demo:false});
const mapLead=r=>({id:r.id,clinic_id:r.clinic_id,name:r.name,phone:r.phone,service:r.service,value:numOrNull(r.value),stage:r.stage,notes:r.notes||"",consent:r.consent,consent_source:r.consent_source,consent_at:fromDBs(r.consent_at),consent_at_raw:r.consent_at,created_at:fromDBs(r.created_at),updated_at:fromDBs(r.updated_at),converted_at:fromDBs(r.converted_at),lost_at:fromDBs(r.lost_at),demo:false});
const mapFu=r=>({id:r.id,clinic_id:r.clinic_id,lead_id:r.lead_id,due_at:fromDB(r.due_at),note:r.note||"",status:r.status,history:(r.history||[]).map(h=>({from:fromDB(h.from),to:fromDB(h.to),at:fromDBs(h.at)})),history_raw:r.history||[],completed_at:fromDBs(r.completed_at),cancelled_at:fromDBs(r.cancelled_at),cancel_reason:r.cancel_reason,created_at:fromDBs(r.created_at)});
const mapMsg=r=>({id:r.id,clinic_id:r.clinic_id,lead_id:r.lead_id,template_id:r.template_id,template_name:r.template_name,body:r.body,action:r.action,delivery:r.delivery,by:r.by_name||"",created_at:fromDBs(r.created_at)});
async function leadsBrief(){const L=await rq(sb().from("leads").select("id,name,service,value,stage,phone,consent").eq("clinic_id",tenant()));return Object.fromEntries(L.map(l=>[l.id,{...l,value:numOrNull(l.value)}]));}
async function remoteFu(id){const f=await rq(sb().from("followups").select("*").eq("id",id).eq("clinic_id",tenant()).maybeSingle());if(!f||f.status!=="pendente")throw new Error("Acompanhamento não está mais pendente.");return f;}

const remote={
  clinic:{
    async me(){const cid=tenant();
      const [c,m,u]=await Promise.all([rq(sb().from("clinics").select("*").eq("id",cid).single()),rq(sb().from("clinic_members").select("display_name").eq("clinic_id",cid).eq("user_id",session.userId).maybeSingle()),sb().auth.getUser()]);
      return{clinic:mapClinic(c),user:{name:m?.display_name||"",email:u?.data?.user?.email||""}};},
    async update(d){const errs=validateClinicInput(d);if(hasErrs(errs))throw new ValidationError(errs);
      const r=await rq(sb().from("clinics").update({name:d.name.trim(),phone:digits(d.phone)||null,attendant_name:d.attendant.trim(),services:d.services}).eq("id",tenant()).select().single());return mapClinic(r);}
  },
  leads:{
    async list(f={}){const cid=tenant();
      const [L,P]=await Promise.all([rq(sb().from("leads").select("*").eq("clinic_id",cid)),rq(sb().from("followups").select("lead_id,due_at").eq("clinic_id",cid).eq("status","pendente").order("due_at"))]);
      const pend={};P.forEach(f=>{(pend[f.lead_id]=pend[f.lead_id]||[]).push(f);});
      return applyLeadFilters(L.map(r=>{const p=pend[r.id]||[];return{...mapLead(r),next_contact:p[0]?fromDB(p[0].due_at):null,pending_count:p.length};}),f);},
    async get(id){const cid=tenant();
      const [r,P]=await Promise.all([rq(sb().from("leads").select("*").eq("id",id).eq("clinic_id",cid).maybeSingle()),rq(sb().from("followups").select("due_at").eq("lead_id",id).eq("clinic_id",cid).eq("status","pendente").order("due_at"))]);
      if(!r)throw new Error("Lead não encontrado nesta clínica.");
      return{...mapLead(r),next_contact:P[0]?fromDB(P[0].due_at):null,pending_count:P.length};},
    async serviceOptions(){const cid=tenant();
      const [c,L]=await Promise.all([rq(sb().from("clinics").select("services").eq("id",cid).single()),rq(sb().from("leads").select("service").eq("clinic_id",cid))]);
      return[...new Set([...(c.services||[]),...L.map(l=>l.service)])].sort((a,b)=>a.localeCompare(b,"pt-BR"));},
    async save(id,d){
      const cid=tenant();let existing=null,cur=null;
      if(id){existing=await remote.leads.get(id);const P=await rq(sb().from("followups").select("*").eq("lead_id",id).eq("clinic_id",cid).eq("status","pendente").order("due_at").limit(1));cur=P[0]?mapFu(P[0]):null;}
      const v=validateLeadInput(d,cur);if(hasErrs(v.errs))throw new ValidationError(v.errs);
      const nowIso=new Date().toISOString();
      const row={name:v.name,phone:v.phone,service:v.service,value:d.value,stage:d.stage,notes:String(d.notes||"").trim()||null,consent:!!d.consent,
        consent_source:d.consent?d.consent_source:null,consent_at:d.consent?(existing&&existing.consent&&existing.consent_at_raw?existing.consent_at_raw:nowIso):null};
      const cancelled=existing&&existing.stage!==d.stage&&CLOSED.includes(d.stage)?existing.pending_count||0:0;
      let saved;
      if(existing)saved=await rq(sb().from("leads").update(row).eq("id",id).eq("clinic_id",cid).select().single());
      else{if(d.stage==="convertido")row.converted_at=nowIso;if(d.stage==="perdido")row.lost_at=nowIso;
        saved=await rq(sb().from("leads").insert({...row,clinic_id:cid}).select().single());}
      if(v.dt&&!CLOSED.includes(d.stage)){
        if(cur){if(cur.due_at!==v.dt)await rq(sb().from("followups").update({due_at:toDB(v.dt),history:[...cur.history_raw,{from:toDB(cur.due_at),to:toDB(v.dt),at:nowIso}]}).eq("id",cur.id));}
        else await rq(sb().from("followups").insert({clinic_id:cid,lead_id:saved.id,due_at:toDB(v.dt),note:"Próximo contato definido no cadastro"}));
      }
      return{lead:mapLead(saved),cancelled,created:!existing};},
    async setStage(id,stage){
      if(!STAGE_IDS.includes(stage))throw new Error("Etapa inválida.");
      const l=await remote.leads.get(id);
      if(stage!=="novo"&&!(l.value>0))throw new Error("Informe o valor do orçamento antes de avançar este lead.");
      if(l.stage===stage)return{lead:l,cancelled:0};
      const r=await rq(sb().from("leads").update({stage}).eq("id",id).eq("clinic_id",tenant()).select().single());
      return{lead:mapLead(r),cancelled:CLOSED.includes(stage)?l.pending_count:0};}
  },
  fu:{
    async list(status){let q=sb().from("followups").select("*").eq("clinic_id",tenant());if(status)q=q.eq("status",status);
      const [F,B]=await Promise.all([rq(q),leadsBrief()]);
      return sortFus(F.map(mapFu).map(f=>({...f,lead:B[f.lead_id]||null})),status);},
    async forLead(id){await remote.leads.get(id);const F=await rq(sb().from("followups").select("*").eq("lead_id",id).eq("clinic_id",tenant()));return sortLeadFus(F.map(mapFu));},
    async counts(){const F=await rq(sb().from("followups").select("due_at").eq("clinic_id",tenant()).eq("status","pendente"));return{due:F.filter(f=>dayDiff(fromDB(f.due_at))<=0).length};},
    async create(d){const errs={};let lead=null;
      if(d.lead_id){try{lead=await remote.leads.get(d.lead_id);}catch(e){if(e.message===NET_MSG)throw e;}}
      if(!lead)errs.lead_id="Escolha um lead.";else if(CLOSED.includes(lead.stage))errs.lead_id="Este lead já foi convertido ou perdido.";
      const v=validateFollowupDate(d.date,d.time);if(v.err)Object.assign(errs,v.err);
      if(hasErrs(errs))throw new ValidationError(errs);
      const r=await rq(sb().from("followups").insert({clinic_id:tenant(),lead_id:lead.id,due_at:toDB(v.dt),note:String(d.note||"").trim()||null}).select().single());return mapFu(r);},
    async reschedule(id,date,time){const f=await remoteFu(id);const v=validateFollowupDate(date,time);if(v.err)throw new ValidationError(v.err);
      const r=await rq(sb().from("followups").update({due_at:toDB(v.dt),history:[...(f.history||[]),{from:f.due_at,to:toDB(v.dt),at:new Date().toISOString()}]}).eq("id",id).eq("status","pendente").select().single());return mapFu(r);},
    async cancel(id){const r=await rq(sb().from("followups").update({status:"cancelado",cancelled_at:new Date().toISOString(),cancel_reason:"Cancelado pela equipe"}).eq("id",id).eq("clinic_id",tenant()).eq("status","pendente").select());
      if(!r.length)throw new Error("Acompanhamento não está mais pendente.");return mapFu(r[0]);},
    async complete(id){const r=await rq(sb().from("followups").update({status:"concluido",completed_at:new Date().toISOString()}).eq("id",id).eq("clinic_id",tenant()).eq("status","pendente").select());
      if(!r.length)throw new Error("Acompanhamento não está mais pendente.");return mapFu(r[0]);}
  },
  msg:{
    async templates(){const T=await rq(sb().from("message_templates").select("*").eq("clinic_id",tenant()).order("created_at"));return T.map(t=>({id:t.id,clinic_id:t.clinic_id,name:t.name,body:t.body}));},
    async saveTemplate(id,d){const v=validateTemplateInput(d);if(hasErrs(v.errs))throw new ValidationError(v.errs);
      if(id)return rq(sb().from("message_templates").update({name:v.name,body:v.body}).eq("id",id).eq("clinic_id",tenant()).select().single());
      return rq(sb().from("message_templates").insert({clinic_id:tenant(),name:v.name,body:v.body}).select().single());},
    async deleteTemplate(id){const r=await rq(sb().from("message_templates").delete().eq("id",id).eq("clinic_id",tenant()).select());if(!r.length)throw new Error("Modelo não encontrado.");},
    async log(d){const lead=await remote.leads.get(d.lead_id);
      if(!lead.consent)throw new Error("Este lead não autorizou receber mensagens.");
      if(!["copiada","whatsapp"].includes(d.action))throw new Error("Ação inválida.");
      const r=await rq(sb().from("message_logs").insert({clinic_id:tenant(),lead_id:lead.id,template_id:d.template_id||null,template_name:d.template_name||"Mensagem livre",body:d.body,action:d.action,by_name:state.me?.user?.name||null}).select().single());
      return mapMsg(r);},
    async list(f={}){let q=sb().from("message_logs").select("*").eq("clinic_id",tenant()).order("created_at",{ascending:false});
      if(f.lead_id)q=q.eq("lead_id",f.lead_id);if(f.action)q=q.eq("action",f.action);
      const [M,B]=await Promise.all([rq(q),leadsBrief()]);
      let R=M.map(mapMsg).map(m=>({...m,lead:B[m.lead_id]||null}));
      if(f.q){const n=norm(f.q);R=R.filter(m=>norm(m.lead?.name).includes(n)||norm(m.body).includes(n)||norm(m.template_name).includes(n));}
      return R;}
  },
  metrics:{
    async dashboard(){const cid=tenant();
      const [L,F,M]=await Promise.all([rq(sb().from("leads").select("*").eq("clinic_id",cid)),rq(sb().from("followups").select("*").eq("clinic_id",cid)),rq(sb().from("message_logs").select("lead_id").eq("clinic_id",cid))]);
      return computeDashboard(L.map(mapLead),F.map(mapFu),M);}
  }
};

/* ---------------- fachada: a UI fala só com estes serviços ---------------- */
const impl=()=>session&&session.mode==="remote"?remote:local;
const facade=k=>new Proxy({},{get:(_,m)=>(...a)=>impl()[k][m](...a)});
const clinicSvc=facade("clinic"),leadsSvc=facade("leads"),fuSvc=facade("fu"),msgSvc=facade("msg"),metricsSvc=facade("metrics");

function authErr(e){const m=String(e?.message||"");
  if(/Invalid login credentials/i.test(m))return new Error("E-mail ou senha incorretos.");
  if(/Email not confirmed/i.test(m))return new Error("Confirme seu e-mail pelo link que enviamos antes de entrar.");
  if(/already registered|already exists/i.test(m))return new ValidationError({email:"Já existe uma conta com este e-mail."});
  if(/Password should|weak/i.test(m))return new ValidationError({pass:"Senha fraca. Use pelo menos 8 caracteres, misturando letras e números."});
  if(/rate limit|security purposes|too many/i.test(m))return new Error("Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.");
  if(/fetch|network/i.test(m))return new Error(NET_MSG);
  return new Error(m||"Não foi possível concluir. Tente de novo.");}
async function authCall(p){let r;try{r=await p;}catch(e){throw new Error(NET_MSG);}if(r.error)throw authErr(r.error);return r.data;}
const validEmail=e=>/^\S+@\S+\.\S+$/.test(e);

const authSvc={
  demo:()=>call(()=>{if(!db.clinics.some(c=>c.id===DEMO_ID))seedDemo();return{mode:"demo",userId:"demo-user",clinicId:DEMO_ID};}),
  async sessionFor(user){const m=await rq(sb().from("clinic_members").select("clinic_id").eq("user_id",user.id).limit(1));
    if(!m.length)throw new Error("Sua conta ainda não está vinculada a uma clínica.");return{mode:"remote",userId:user.id,clinicId:m[0].clinic_id};},
  async signIn(email,pass){const errs={};const e=String(email||"").trim().toLowerCase();
    if(!validEmail(e))errs.email="Informe um e-mail válido.";if(!pass)errs.pass="Informe sua senha.";
    if(hasErrs(errs))throw new ValidationError(errs);
    const d=await authCall(sb().auth.signInWithPassword({email:e,password:pass}));return authSvc.sessionFor(d.user);},
  async signUp(d){const errs={};const email=String(d.email||"").trim().toLowerCase();
    if(String(d.clinic||"").trim().length<2)errs.clinic="Informe o nome da clínica.";
    if(String(d.name||"").trim().length<2)errs.name="Informe seu nome.";
    if(!validEmail(email))errs.email="Informe um e-mail válido.";
    if(d.phone&&![10,11].includes(digits(d.phone).length))errs.phone="Use DDD + número (10 ou 11 dígitos).";
    if(String(d.pass||"").length<8)errs.pass="A senha precisa ter pelo menos 8 caracteres.";else if(d.pass!==d.pass2)errs.pass2="As senhas não conferem.";
    if(hasErrs(errs))throw new ValidationError(errs);
    const r=await authCall(sb().auth.signUp({email,password:d.pass,options:{data:{clinic_name:d.clinic.trim(),name:d.name.trim(),phone:digits(d.phone)},emailRedirectTo:location.origin+"/app"}}));
    if(r.user&&Array.isArray(r.user.identities)&&r.user.identities.length===0)throw new ValidationError({email:"Já existe uma conta com este e-mail."});
    if(r.session)return{session:await authSvc.sessionFor(r.user)};
    return{confirm:true,email};},
  async recover(email){const e=String(email||"").trim().toLowerCase();if(!validEmail(e))throw new ValidationError({email:"Informe um e-mail válido."});
    await authCall(sb().auth.resetPasswordForEmail(e,{redirectTo:location.origin+"/app"}));return e;},
  async newPassword(p,p2){const errs={};if(String(p||"").length<8)errs.pass="A senha precisa ter pelo menos 8 caracteres.";else if(p!==p2)errs.pass2="As senhas não conferem.";
    if(hasErrs(errs))throw new ValidationError(errs);const d=await authCall(sb().auth.updateUser({password:p}));return authSvc.sessionFor(d.user);},
  async access(){const r=await rq(sb().rpc("my_access"));const a=Array.isArray(r)?r[0]:r;return a||{has_access:false};},
  async restore(){try{const{data}=await sb().auth.getSession();if(!data.session)return null;return await authSvc.sessionFor(data.session.user);}catch(e){return null;}},
  async signOut(){if(session&&session.mode==="remote"){try{await sb().auth.signOut();}catch(e){}}}
};

/* ---------------- ícones ---------------- */
const IC={
 home:'<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h13V9"/><path d="M10 20v-5h4v5"/>',
 users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.7a3.5 3.5 0 0 1 0 6.6M18.6 14.8c1.6.7 2.6 2.4 2.9 5.2"/>',
 columns:'<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
 chat:'<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/>',
 gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M2.5 12h3M18.5 12h3M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
 copy:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
 send:'<path d="M21 3 10 14"/><path d="M21 3 14 21l-4-7-7-4z"/>',edit:'<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
 x:'<path d="M6 6l12 12M18 6 6 18"/>',check:'<path d="m5 12.5 4.5 4.5L19 7"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 logout:'<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>',menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
 alert:'<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
 shield:'<path d="M12 3 4.5 6v6c0 4.4 3.2 7.8 7.5 9 4.3-1.2 7.5-4.6 7.5-9V6z"/><path d="m9 12 2 2 4-4"/>',
 refresh:'<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 20v-4h-4"/>',
 trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',circle:'<circle cx="12" cy="12" r="8"/>',
 lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',file:'<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>'};
const icon=(n,s=18)=>`<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]||""}</svg>`;
const LOGO=`<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--accent)"/><path d="M22.6 18.2A7 7 0 1 1 20.4 10" fill="none" stroke="var(--accent-ink)" stroke-width="2.6" stroke-linecap="round"/><path d="M21.5 5.8v4.8h-4.8" fill="none" stroke="var(--accent-ink)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* ---------------- UI helpers ---------------- */
const state={recovery:false,route:"dashboard",leadFilters:{q:"",stage:"",service:"",contact:"",consent:""},agendaTab:"pendente",msgFilters:{q:"",action:""},drawerLead:null,me:null};
let renderToken=0;
function toast(msg,type){const t=document.createElement("div");t.className="toast"+(type==="err"?" err":"");t.innerHTML=`${icon(type==="err"?"alert":"check",16)}<span>${esc(msg)}</span>`;$("#toasts").appendChild(t);setTimeout(()=>t.remove(),type==="err"?6000:3800);}
const stageBadge=s=>`<span class="badge s-${s}">${esc(stageLabel(s))}</span>`;
function dueBadge(dt){if(!dt)return`<span class="due none">Sem próximo contato</span>`;const n=dayDiff(dt),t=fmtTime(dt);
  if(n<0)return`<span class="due late">${icon("clock",14)}${n===-1?"Atrasado · ontem":`Atrasado · ${-n} dias`}</span>`;
  if(n===0)return`<span class="due today">${icon("clock",14)}Hoje, ${t}</span>`;
  if(n===1)return`<span class="due">${icon("clock",14)}Amanhã, ${t}</span>`;
  return`<span class="due">${icon("clock",14)}${fmtDate(dt)}, ${t}</span>`;}
const consentTag=l=>l.consent?`<span class="consent">${icon("check",14)}Autorizado</span>`:`<span class="consent no">${icon("alert",14)}Sem autorização</span>`;
function head(title,sub,actions=""){return`<div class="ph"><div><h1>${esc(title)}</h1>${sub?`<p class="sub">${sub}</p>`:""}</div>${actions?`<div class="ph-actions">${actions}</div>`:""}</div>`;}
const skelLines=n=>`<div class="card" aria-busy="true" aria-label="Carregando"><div style="display:flex;flex-direction:column;gap:14px">${Array.from({length:n},(_,i)=>`<div class="sk sk-line" style="width:${[92,78,85,64,88,70][i%6]}%"></div>`).join("")}</div></div>`;
const skelKpis=()=>`<div class="kpis">${Array.from({length:5},()=>`<div class="kpi"><div class="sk sk-line" style="width:60%"></div><div class="sk" style="height:28px;width:45%"></div><div class="sk sk-line" style="width:75%"></div></div>`).join("")}</div>`;
function errorBox(err){return`<div class="error-box" role="alert">${icon("alert",20)}<div><strong>Não foi possível carregar.</strong><p>${esc(err.message||"Erro inesperado.")}</p><button class="btn sm" data-retry>${icon("refresh",14)}Tentar de novo</button></div></div>`;}
function showError(el,err,retry){el.innerHTML=errorBox(err);const b=$("[data-retry]",el);if(b)b.onclick=retry;}
function empty({ic="users",title,text,action=""}){return`<div class="empty"><div class="e-ic">${icon(ic,22)}</div><strong>${esc(title)}</strong>${text?`<p>${text}</p>`:""}${action}</div>`;}
async function busy(btn,fn,label="Salvando…"){if(!btn)return fn();const h=btn.innerHTML;btn.disabled=true;btn.innerHTML=`<span class="spin"></span>${label}`;try{return await fn();}finally{if(btn.isConnected){btn.disabled=false;btn.innerHTML=h;}}}
function clearErrors(form){$$(".err",form).forEach(e=>e.remove());$$('[aria-invalid="true"]',form).forEach(e=>e.removeAttribute("aria-invalid"));const a=$(".form-alert",form);if(a)a.remove();}
function showErrors(form,err){clearErrors(form);
  if(err instanceof ValidationError){let first=null;Object.entries(err.fields).forEach(([k,m])=>{const inp=form.querySelector(`[name="${k}"]`);if(!inp)return;inp.setAttribute("aria-invalid","true");const p=document.createElement("p");p.className="err";p.textContent=m;(inp.closest(".field")||inp.parentElement).appendChild(p);first=first||inp;});if(first)first.focus();}
  else{const a=document.createElement("div");a.className="form-alert";a.setAttribute("role","alert");a.textContent=err.message||"Não foi possível salvar.";form.prepend(a);}}
async function copyText(text,fallback){try{await navigator.clipboard.writeText(text);return true;}catch(e){if(fallback){fallback.focus();fallback.select&&fallback.select();}return false;}}

/* ---------------- overlays ---------------- */
function openModal({title,body,footer="",size="",onMount}){const root=$("#modal-root");
  root.innerHTML=`<div class="scrim" data-act="closeModal"></div><div class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="mTitle"><div class="m-head"><h2 id="mTitle">${esc(title)}</h2><button class="icon-btn" data-act="closeModal" aria-label="Fechar">${icon("x")}</button></div><div class="m-body">${body}</div>${footer?`<div class="m-foot">${footer}</div>`:""}</div>`;
  root.hidden=false;onMount&&onMount(root);const f=$(".m-body input:not([type=checkbox]),.m-body select,.m-body textarea",root);if(f)setTimeout(()=>f.focus(),30);}
function closeModal(){const r=$("#modal-root");r.hidden=true;r.innerHTML="";}
let confirmDone=null;
function confirmDialog({title,body,ok="Confirmar",danger=false}){return new Promise(res=>{const root=$("#confirm-root");
  root.innerHTML=`<div class="scrim"></div><div class="modal sm" role="alertdialog" aria-modal="true" aria-labelledby="cTitle"><div class="m-head"><h2 id="cTitle">${esc(title)}</h2></div><div class="m-body"><p style="color:var(--fg-2)">${body}</p></div><div class="m-foot"><button class="btn ghost" data-r="0">Voltar</button><button class="btn ${danger?"danger":"primary"}" data-r="1">${esc(ok)}</button></div></div>`;
  root.hidden=false;const done=v=>{root.hidden=true;root.innerHTML="";confirmDone=null;res(v);};confirmDone=done;
  $$("[data-r]",root).forEach(b=>b.onclick=()=>done(b.dataset.r==="1"));$(".scrim",root).onclick=()=>done(false);$('[data-r="1"]',root).focus();});}
function closeDrawer(){state.drawerLead=null;const r=$("#drawer-root");r.hidden=true;r.innerHTML="";}

/* ---------------- roteamento ---------------- */
const ROUTES={dashboard:{label:"Painel",ic:"home",fn:()=>pageDashboard},leads:{label:"Leads",ic:"users",fn:()=>pageLeads},pipeline:{label:"Pipeline",ic:"columns",fn:()=>pagePipeline},agenda:{label:"Agenda",ic:"calendar",fn:()=>pageAgenda},mensagens:{label:"Mensagens",ic:"chat",fn:()=>pageMensagens},config:{label:"Configurações",ic:"gear",fn:()=>pageConfig}};
function go(r){state.route=r;closeDrawer();closeModal();$(".app")?.classList.remove("nav-open");render();window.scrollTo(0,0);}
const CHECKOUT={mensal:"https://pay.kiwify.com.br/BmGzBlg",anual:"https://pay.kiwify.com.br/8haEoPI"};
async function loadAccess(s){if(s&&s.mode==="remote"){try{s.access=await authSvc.access();}catch(e){s.access={has_access:false,error:e.message};}}return s;}
function renderPaywall(){
  const a=session.access||{};const em=esc(a.email||"");
  const why={cancelada:"Sua assinatura foi cancelada e o per\u00edodo pago terminou.",reembolsada:"O pagamento desta assinatura foi reembolsado.",chargeback:"O pagamento desta assinatura foi contestado no cart\u00e3o."}[a.status]||"Ainda n\u00e3o encontramos uma assinatura ativa para este e-mail.";
  $("#app").innerHTML=`<div class="auth"><section class="auth-side"><a class="brand" href="/" style="text-decoration:none">${LOGO}Retoma</a>
    <div class="auth-copy"><h1>Falta s\u00f3 ativar a assinatura.</h1><p>Sua conta foi criada. Assim que o pagamento for confirmado pela Kiwify, o acesso \u00e9 liberado automaticamente para o e-mail da compra.</p></div><span></span></section>
    <section class="auth-main"><div class="auth-card">
      <div class="ah"><h2 style="font-size:22px">Assinatura n\u00e3o encontrada</h2><p style="color:var(--fg-2);margin-top:8px">${why} Conta: <strong>${em}</strong></p></div>
      ${a.error?`<div class="form-alert">${esc(a.error)}</div>`:""}
      <div class="warn-box">${icon("info",16)}<span>Use na compra <strong>o mesmo e-mail desta conta</strong>. Se voc\u00ea pagou com outro e-mail, crie a conta do Retoma com o e-mail da compra.</span></div>
      <a class="btn primary block" href="${CHECKOUT.mensal}" target="_blank" rel="noopener">Assinar plano Mensal \u00b7 R$ 147/m\u00eas</a>
      <a class="btn block" href="${CHECKOUT.anual}" target="_blank" rel="noopener">Assinar plano Anual \u00b7 R$ 1.188 (at\u00e9 12x)</a>
      <div class="divider">j\u00e1 pagou?</div>
      <button class="btn block" data-act="recheckAccess">${icon("refresh",16)}Verificar pagamento de novo</button>
      <p class="auth-note">O Pix e o cart\u00e3o costumam ser confirmados em poucos minutos. Boleto pode levar at\u00e9 3 dias \u00fateis. <button class="link-btn" data-act="logout">Sair</button></p>
    </div></section></div>`;
}
function render(){if(!session)return renderAuth(state.recovery?"nova-senha":["cadastro","recuperar"].includes(state.route)?state.route:"login");if(session.mode==="remote"&&!(session.access&&session.access.has_access))return renderPaywall();if(!ROUTES[state.route])state.route="dashboard";renderApp();}
async function refresh(){const el=$("#page");if(el&&session&&ROUTES[state.route])ROUTES[state.route].fn()(el,{quiet:true});if(state.drawerLead)loadDrawer();updateNavCount();}

async function renderApp(){
  const r=state.route;const demo=session.clinicId===DEMO_ID;
  $("#app").innerHTML=`<div class="app">
    <aside class="side" id="side" aria-label="Navegação principal">
      <div class="brand">${LOGO}Retoma</div>
      <nav class="nav">${Object.entries(ROUTES).map(([k,v])=>`<button class="nav-btn" data-act="nav" data-r="${k}" ${k===r?'aria-current="page"':""}>${icon(v.ic)}<span>${v.label}</span>${k==="agenda"?'<span class="count" id="navCount" hidden></span>':""}</button>`).join("")}</nav>
      <div class="side-foot"><div class="clinic-chip"><div class="avatar" id="meAv">··</div><div class="t"><strong id="meClinic">Carregando…</strong><span id="meUser"></span></div></div>
      <button class="btn ghost sm" data-act="logout" style="justify-content:flex-start">${icon("logout",15)}Sair</button></div>
    </aside>
    <div class="side-scrim" data-act="closeNav"></div>
    <div class="main">
      <header class="mtop"><button class="icon-btn" data-act="openNav" aria-label="Abrir menu">${icon("menu",20)}</button><div class="brand">${LOGO}Retoma</div></header>
      ${demo?`<div class="demo-banner">${icon("info",16)}<span><strong>Clínica de demonstração.</strong> Nomes, telefones e valores são fictícios e ficam só neste navegador.</span></div>`:""}
      <main id="page" class="page" tabindex="-1"></main>
    </div></div>`;
  ROUTES[r].fn()($("#page"));
  clinicSvc.me().then(m=>{state.me=m;$("#meClinic").textContent=m.clinic.name;$("#meUser").textContent=m.user.name;$("#meAv").textContent=initials(m.clinic.name);}).catch(()=>{$("#meClinic").textContent="Clínica";});
  updateNavCount();
}
function updateNavCount(){fuSvc.counts().then(c=>{const el=$("#navCount");if(!el)return;el.hidden=!c.due;el.textContent=c.due;el.title=`${c.due} contato(s) para hoje ou atrasados`;}).catch(()=>{});}

/* ---------------- Auth ---------------- */
function renderAuth(mode,info={}){
  let card="";
  if(mode==="login")card=`
     <div class="ah"><h2 style="font-size:22px">Entrar</h2><p>Acesse a conta da sua clínica.</p></div>
     <form class="form" id="authForm" novalidate>
       <div class="field"><label for="aEmail">E-mail</label><input class="input" id="aEmail" name="email" type="email" autocomplete="email" required></div>
       <div class="field"><label for="aPass">Senha</label><input class="input" id="aPass" name="pass" type="password" autocomplete="current-password" required><button type="button" class="link-btn" data-act="toRecover" style="align-self:flex-start;font-size:12.5px">Esqueci minha senha</button></div>
       <button class="btn primary block" type="submit">Entrar</button>
     </form>
     <p class="muted">Já assinou? <button class="link-btn" data-act="toCadastro">Criar a conta da clínica</button> · Ainda não? <a href="/#planos" style="font-weight:600">Ver planos</a></p>
     <div class="divider">ou</div>
     <button class="btn block" data-act="demo">${icon("users",16)}Explorar a clínica de demonstração</button>`;
  else if(mode==="cadastro")card=`
     <div class="ah"><h2 style="font-size:22px">Cadastrar clínica</h2><p>Crie o espaço da sua clínica. Cada clínica vê apenas os próprios dados.</p></div>
     <div class="info-box">${icon("info",16)}<span>Use <strong>o mesmo e-mail da compra na Kiwify</strong>. É assim que liberamos o seu acesso.</span></div>
     <form class="form" id="authForm" novalidate>
       <div class="field"><label for="sClinic">Nome da clínica <span class="req">*</span></label><input class="input" id="sClinic" name="clinic" autocomplete="organization"></div>
       <div class="grid2">
         <div class="field"><label for="sName">Seu nome <span class="req">*</span></label><input class="input" id="sName" name="name" autocomplete="name"></div>
         <div class="field"><label for="sPhone">WhatsApp da clínica</label><input class="input" id="sPhone" name="phone" inputmode="tel" placeholder="(85) 90000-0000" data-mask="phone"></div>
       </div>
       <div class="field"><label for="sEmail">E-mail <span class="req">*</span></label><input class="input" id="sEmail" name="email" type="email" autocomplete="email"></div>
       <div class="grid2">
         <div class="field"><label for="sPass">Senha <span class="req">*</span></label><input class="input" id="sPass" name="pass" type="password" autocomplete="new-password"><span class="hint">Mínimo de 8 caracteres.</span></div>
         <div class="field"><label for="sPass2">Confirmar senha <span class="req">*</span></label><input class="input" id="sPass2" name="pass2" type="password" autocomplete="new-password"></div>
       </div>
       <button class="btn primary block" type="submit">Criar conta da clínica</button>
     </form>
     <p class="muted">Já tem conta? <button class="link-btn" data-act="toLogin">Entrar</button></p>`;
  else if(mode==="recuperar")card=`
     <div class="ah"><h2 style="font-size:22px">Recuperar senha</h2><p>Enviaremos um link para você criar uma nova senha.</p></div>
     <form class="form" id="authForm" novalidate>
       <div class="field"><label for="rEmail">E-mail da conta</label><input class="input" id="rEmail" name="email" type="email" autocomplete="email"></div>
       <button class="btn primary block" type="submit">Enviar link</button>
     </form>
     <p class="muted"><button class="link-btn" data-act="toLogin">Voltar para entrar</button></p>`;
  else if(mode==="nova-senha")card=`
     <div class="ah"><h2 style="font-size:22px">Criar nova senha</h2><p>Escolha a nova senha da sua conta.</p></div>
     <form class="form" id="authForm" novalidate>
       <div class="field"><label for="nPass">Nova senha</label><input class="input" id="nPass" name="pass" type="password" autocomplete="new-password"><span class="hint">Mínimo de 8 caracteres.</span></div>
       <div class="field"><label for="nPass2">Confirmar nova senha</label><input class="input" id="nPass2" name="pass2" type="password" autocomplete="new-password"></div>
       <button class="btn primary block" type="submit">Salvar e entrar</button>
     </form>`;
  else card=`
     <div class="ah"><div class="e-ic" style="width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);margin-bottom:12px">${icon("send",22)}</div><h2 style="font-size:22px">${esc(info.title)}</h2><p style="color:var(--fg-2);margin-top:8px">${info.text}</p></div>
     <button class="btn block" data-act="toLogin">Voltar para entrar</button>`;

  $("#app").innerHTML=`<div class="auth">
   <section class="auth-side">
     <a class="brand" href="/" style="text-decoration:none">${LOGO}Retoma</a>
     <div class="auth-copy"><h1>Orçamento enviado ainda não é venda perdida.</h1><p>O Retoma organiza os retornos de quem pediu orçamento e não fechou: quem precisa de contato hoje, em que etapa cada paciente está e qual mensagem enviar pelo WhatsApp.</p></div>
     <div class="bubble" aria-hidden="true"><div class="b-meta">Modelo · Primeiro retorno</div><p>Olá, <mark>{{nome}}</mark>! Passando para saber se ficou alguma dúvida sobre o orçamento de <mark>{{servico}}</mark>. Posso te ajudar com algo?</p></div>
   </section>
   <section class="auth-main"><div class="auth-card">${card}
     <p class="auth-note">${icon("lock",13)} Cada clínica acessa somente os próprios dados. A demonstração usa dados fictícios, guardados só neste navegador, e não cria conta.</p>
   </div></section></div>`;

  const form=$("#authForm");if(!form)return;
  const labels={login:"Entrando…",cadastro:"Criando conta…",recuperar:"Enviando…","nova-senha":"Salvando…"};
  form.addEventListener("submit",async e=>{e.preventDefault();const fd=Object.fromEntries(new FormData(form));const btn=$("button[type=submit]",form);
    try{
      const r=await busy(btn,async()=>{
        if(mode==="login")return{session:await authSvc.signIn(fd.email,fd.pass)};
        if(mode==="cadastro")return authSvc.signUp(fd);
        if(mode==="recuperar"){const em=await authSvc.recover(fd.email);return{sent:em};}
        if(mode==="nova-senha")return{session:await authSvc.newPassword(fd.pass,fd.pass2),pwd:true};
      },labels[mode]);
      if(r.session){session=await loadAccess(r.session);saveSession();state.recovery=false;state.route="dashboard";render();toast(r.pwd?"Senha atualizada.":mode==="cadastro"?"Conta criada. Cadastre o primeiro lead da clínica.":"Bem-vinda de volta.");return;}
      if(r.confirm)return renderAuth("aviso",{title:"Confirme seu e-mail",text:`Enviamos um link de confirmação para <strong>${esc(r.email)}</strong>. Abra o e-mail, toque no link e depois entre com sua senha. Se não encontrar, olhe a caixa de spam.`});
      if(r.sent)return renderAuth("aviso",{title:"Verifique seu e-mail",text:`Se houver uma conta com <strong>${esc(r.sent)}</strong>, você vai receber um link para criar uma nova senha.`});
    }catch(err){showErrors(form,err);}});
}

/* ---------------- Painel ---------------- */
async function pageDashboard(el,{quiet}={}){
  const tk=++renderToken;
  if(!quiet)el.innerHTML=head("Painel",`${greeting()}. ${new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}.`)+skelKpis()+`<div class="dash-grid">${skelLines(5)}${skelLines(6)}</div>`;
  try{
    const d=await metricsSvc.dashboard();if(tk!==renderToken)return;
    const maxC=Math.max(1,...d.byStage.map(s=>s.count));
    el.innerHTML=head("Painel",`${greeting()}. ${new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}.`,`<button class="btn primary" data-act="newLead">${icon("plus")}Novo lead</button>`)+`
    <div class="kpis">
      <div class="kpi"><span class="k-l">Total de leads</span><span class="k-v">${d.total}</span><span class="k-s">${d.byStage[0].count} novos sem orçamento</span></div>
      <div class="kpi"><span class="k-l">Orçamentos em aberto</span><span class="k-v">${d.openCount}</span><span class="k-s"><b>${money0(d.openValue)}</b> em jogo</span></div>
      <div class="kpi"><span class="k-l">Acompanhamentos pendentes</span><span class="k-v">${d.pending}</span><span class="k-s">${d.overdue?`<span class="late">${d.overdue} atrasado${d.overdue>1?"s":""}</span>`:"Nenhum atrasado"}</span></div>
      <div class="kpi hl"><span class="k-l">Vendas recuperadas</span><span class="k-v">${d.recovered}</span><span class="k-s" title="Convertidos que tiveram ao menos um acompanhamento concluído ou mensagem registrada"><b>${money0(d.recoveredValue)}</b> após acompanhamento</span></div>
      <div class="kpi"><span class="k-l">Valor vendido</span><span class="k-v">${money0(d.soldValue)}</span><span class="k-s">${d.converted} venda${d.converted===1?"":"s"}${d.closeRate!=null?` · ${d.closeRate}% dos encerrados`:""}</span></div>
    </div>
    ${d.total===0?`<div class="card">${empty({ic:"users",title:"Nenhum lead cadastrado ainda",text:"Cadastre os pacientes que receberam orçamento e não fecharam. Os indicadores acima passam a ser calculados com esses dados.",action:`<button class="btn primary" data-act="newLead">${icon("plus")}Cadastrar primeiro lead</button>`})}</div>`:`
    <div class="dash-grid">
      <div class="stack">
        <section class="card"><div class="card-h"><h2>Para contatar hoje</h2><button class="btn ghost sm" data-act="nav" data-r="agenda">Ver agenda</button></div>
          ${d.due.length?`<div class="rows">${d.due.map(f=>`<div class="row"><div class="r-main"><button class="lead-link" data-act="openLead" data-id="${f.lead_id}">${esc(f.lead?.name)}</button><span>${esc(f.lead?.service)} · ${money(f.lead?.value)}${f.note?` · ${esc(f.note)}`:""}</span></div>${dueBadge(f.due_at)}<div class="r-act"><button class="btn sm" data-act="compose" data-id="${f.lead_id}" data-fu="${f.id}">${icon("chat",14)}Mensagem</button><button class="btn sm ghost" data-act="completeFu" data-id="${f.id}">${icon("check",14)}Concluir</button></div></div>`).join("")}</div>`
          :empty({ic:"check",title:"Nada para hoje",text:"Não há contatos atrasados nem marcados para hoje. Os próximos aparecem na agenda."}).replace('class="empty"','class="empty sm"')}
        </section>
        <section class="card"><div class="card-h"><h2>Orçamentos sem próximo contato</h2><span class="hint">${d.stale.length} em aberto</span></div>
          ${d.stale.length?`<div class="rows">${d.stale.slice(0,6).map(l=>`<div class="row"><div class="r-main"><button class="lead-link" data-act="openLead" data-id="${l.id}">${esc(l.name)}</button><span>${esc(l.service)} · ${money(l.value)}</span></div>${stageBadge(l.stage)}<div class="r-act"><button class="btn sm" data-act="newFollowup" data-lead="${l.id}">${icon("calendar",14)}Agendar</button></div></div>`).join("")}</div>`
          :`<p class="muted">Todos os orçamentos em aberto têm um próximo contato agendado.</p>`}
        </section>
      </div>
      <section class="card"><div class="card-h"><h2>Funil comercial</h2><button class="btn ghost sm" data-act="nav" data-r="pipeline">Abrir pipeline</button></div>
        <div class="funnel">${d.byStage.map(s=>`<div class="f-row" data-s="${s.id}"><span class="f-l">${s.label}</span><div class="f-track"><div class="f-bar" style="width:${s.count?Math.max(3,s.count/maxC*100):0}%"></div></div><span class="f-n">${s.count}</span></div>`).join("")}</div>
        <div class="f-foot"><span>Em aberto: <b class="num">${money0(d.openValue)}</b></span><span>Vendido: <b class="num">${money0(d.soldValue)}</b></span></div>
      </section>
    </div>`}`;
  }catch(err){if(tk===renderToken)showError(el,err,()=>pageDashboard(el));}
}

/* ---------------- Leads ---------------- */
let qTimer;
async function pageLeads(el,{quiet}={}){
  const f=state.leadFilters;
  if(!quiet){
    el.innerHTML=head("Leads","Pacientes que pediram orçamento e o andamento de cada um.",`<button class="btn primary" data-act="newLead">${icon("plus")}Novo lead</button>`)+`
    <div class="toolbar" role="search">
      <label class="search"><span class="sr">Buscar leads</span>${icon("search",16)}<input class="input" id="fQ" type="search" placeholder="Buscar por nome, telefone ou serviço" value="${esc(f.q)}"></label>
      <select class="input" id="fStage" aria-label="Filtrar por etapa"><option value="">Todas as etapas</option>${STAGES.map(s=>`<option value="${s.id}" ${f.stage===s.id?"selected":""}>${s.label}</option>`).join("")}</select>
      <select class="input" id="fService" aria-label="Filtrar por serviço"><option value="">Todos os serviços</option></select>
      <select class="input" id="fContact" aria-label="Filtrar por próximo contato">${[["","Qualquer contato"],["atrasado","Contato atrasado"],["hoje","Contato hoje"],["semana","Próximos 7 dias"],["sem","Sem próximo contato"]].map(([v,l])=>`<option value="${v}" ${f.contact===v?"selected":""}>${l}</option>`).join("")}</select>
      <select class="input" id="fConsent" aria-label="Filtrar por autorização">${[["","Autorização: todas"],["sim","Com autorização"],["nao","Sem autorização"]].map(([v,l])=>`<option value="${v}" ${f.consent===v?"selected":""}>${l}</option>`).join("")}</select>
      <button class="btn ghost sm" id="fClear">${icon("x",14)}Limpar</button>
    </div>
    <div id="leadsResult"></div>`;
    leadsSvc.serviceOptions().then(opts=>{const s=$("#fService");if(!s)return;s.innerHTML=`<option value="">Todos os serviços</option>`+opts.map(o=>`<option ${f.service===o?"selected":""}>${esc(o)}</option>`).join("");}).catch(()=>{});
    $("#fQ").addEventListener("input",e=>{clearTimeout(qTimer);qTimer=setTimeout(()=>{f.q=e.target.value;loadLeads();},220);});
    [["fStage","stage"],["fService","service"],["fContact","contact"],["fConsent","consent"]].forEach(([id,k])=>$("#"+id).addEventListener("change",e=>{f[k]=e.target.value;loadLeads();}));
    $("#fClear").onclick=()=>{Object.keys(f).forEach(k=>f[k]="");pageLeads(el);};
  }
  loadLeads(quiet);
}
async function loadLeads(quiet){
  const box=$("#leadsResult");if(!box)return;const tk=++renderToken;const f=state.leadFilters;
  const filtered=Object.values(f).some(Boolean);$("#fClear").hidden=!filtered;
  if(!quiet)box.innerHTML=skelLines(6);
  try{
    const L=await leadsSvc.list(f);if(tk!==renderToken)return;
    if(!L.length){box.innerHTML=`<div class="card">${filtered?empty({ic:"search",title:"Nenhum lead encontrado",text:"Nenhum lead corresponde à busca e aos filtros escolhidos.",action:`<button class="btn" data-act="clearLeadFilters">Limpar filtros</button>`}):empty({ic:"users",title:"Nenhum lead cadastrado",text:"Cadastre quem recebeu orçamento para começar a acompanhar os retornos.",action:`<button class="btn primary" data-act="newLead">${icon("plus")}Novo lead</button>`})}</div>`;return;}
    const total=L.reduce((s,l)=>s+(l.value||0),0);
    box.innerHTML=`<p class="result-meta">${L.length} lead${L.length>1?"s":""} · ${money0(total)} em orçamentos</p>
    <div class="table-wrap"><table><thead><tr><th>Nome</th><th>Serviço</th><th>Valor</th><th>Etapa</th><th>Próximo contato</th><th>Mensagens</th><th><span class="sr">Ações</span></th></tr></thead><tbody>
    ${L.map(l=>`<tr class="click" data-act="openLead" data-id="${l.id}" tabindex="0"><td><strong>${esc(l.name)}</strong><span class="sub">${fmtPhone(l.phone)}</span></td><td>${esc(l.service)}</td><td class="money">${money(l.value)}</td><td>${stageBadge(l.stage)}</td><td>${CLOSED.includes(l.stage)?`<span class="due none">Encerrado</span>`:dueBadge(l.next_contact)}</td><td>${consentTag(l)}</td>
    <td class="acts"><button class="btn sm" data-act="compose" data-id="${l.id}" ${l.consent?"":"disabled title='Sem autorização para mensagens'"}>${icon("chat",14)}Mensagem</button> <button class="icon-btn" data-act="editLead" data-id="${l.id}" aria-label="Editar ${esc(l.name)}">${icon("edit",16)}</button></td></tr>`).join("")}
    </tbody></table></div>`;
  }catch(err){if(tk===renderToken)showError(box,err,()=>loadLeads());}
}

/* ---------------- Formulário de lead ---------------- */
async function openLeadForm(id){
  openModal({title:id?"Editar lead":"Novo lead",size:"lg",body:skelLines(6)});
  try{
    const [lead,opts]=await Promise.all([id?leadsSvc.get(id):Promise.resolve(null),leadsSvc.serviceOptions()]);
    const l=lead||{name:"",phone:"",service:"",value:null,stage:"orcamento",notes:"",consent:false,consent_source:""};
    const nd=l.next_contact?l.next_contact.slice(0,10):"",nt=l.next_contact?fmtTime(l.next_contact):"10:00";
    openModal({title:id?"Editar lead":"Novo lead",size:"lg",
      body:`<form class="form" id="leadForm" novalidate>
        <div class="grid2">
          <div class="field"><label for="lName">Nome completo <span class="req">*</span></label><input class="input" id="lName" name="name" value="${esc(l.name)}" autocomplete="off"></div>
          <div class="field"><label for="lPhone">Telefone (WhatsApp) <span class="req">*</span></label><input class="input" id="lPhone" name="phone" inputmode="tel" placeholder="(85) 90000-0000" value="${esc(maskPhone(l.phone))}" data-mask="phone"></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="lService">Serviço <span class="req">*</span></label><input class="input" id="lService" name="service" list="svcList" value="${esc(l.service)}" autocomplete="off"><datalist id="svcList">${opts.map(o=>`<option value="${esc(o)}">`).join("")}</datalist></div>
          <div class="field"><label for="lValue">Valor do orçamento (R$)</label><input class="input num" id="lValue" name="value" inputmode="decimal" placeholder="0,00" value="${esc(moneyInput(l.value))}" data-mask="money"></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="lStage">Etapa comercial</label><select class="input" id="lStage" name="stage">${STAGES.map(s=>`<option value="${s.id}" ${l.stage===s.id?"selected":""}>${s.label}</option>`).join("")}</select></div>
          <div class="field"><label for="lDate">Próxima data de contato</label><div style="display:grid;grid-template-columns:minmax(0,1fr) 104px;gap:8px"><input class="input" type="date" id="lDate" name="next_date" value="${nd}" min="${isoDate(new Date())}"><input class="input" type="time" name="next_time" aria-label="Horário" value="${nt}"></div></div>
        </div>
        <div class="field"><label for="lNotes">Observações</label><textarea class="input" id="lNotes" name="notes" rows="2" placeholder="Ex.: pediu parcelamento, prefere contato à tarde">${esc(l.notes)}</textarea></div>
        <div class="field">
          <label class="check" for="lConsent"><input type="checkbox" id="lConsent" name="consent" ${l.consent?"checked":""}><span><strong>O paciente autorizou receber mensagens da clínica pelo WhatsApp</strong><span class="hint">Sem essa autorização o Retoma não prepara mensagens para este lead.${l.consent_at?` Registrada em ${fmtDT(l.consent_at)}.`:""}</span></span></label>
        </div>
        <div class="field" id="srcField" ${l.consent?"":"hidden"}><label for="lSrc">Como a autorização foi obtida</label><select class="input" id="lSrc" name="consent_source"><option value="">Selecione</option>${CONSENT_SOURCES.map(s=>`<option ${l.consent_source===s?"selected":""}>${s}</option>`).join("")}</select></div>
      </form>`,
      footer:`<button class="btn ghost" data-act="closeModal">Cancelar</button><button class="btn primary" type="submit" form="leadForm">${id?"Salvar alterações":"Cadastrar lead"}</button>`,
      onMount:root=>{
        const form=$("#leadForm",root);
        $("#lConsent",root).addEventListener("change",e=>{$("#srcField",root).hidden=!e.target.checked;});
        form.addEventListener("submit",async e=>{e.preventDefault();const fd=new FormData(form);
          const data={name:fd.get("name"),phone:fd.get("phone"),service:fd.get("service"),value:parseMoney(fd.get("value")),stage:fd.get("stage"),next_date:fd.get("next_date"),next_time:fd.get("next_time"),notes:fd.get("notes"),consent:fd.get("consent")==="on",consent_source:fd.get("consent_source")};
          try{const r=await busy($('button[form="leadForm"]'),()=>leadsSvc.save(id,data));closeModal();
            toast(r.created?`${r.lead.name} cadastrado(a).`:"Alterações salvas."+(r.cancelled?` ${r.cancelled} acompanhamento(s) pendente(s) cancelado(s).`:""));refresh();}
          catch(err){showErrors(form,err);}});
      }});
  }catch(err){$("#modal-root .m-body").innerHTML=errorBox(err);const b=$("#modal-root [data-retry]");if(b)b.onclick=()=>openLeadForm(id);}
}

/* ---------------- Gaveta do lead ---------------- */
async function openLead(id){state.drawerLead=id;const root=$("#drawer-root");
  root.innerHTML=`<div class="scrim" data-act="closeDrawer"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Detalhes do lead"><div class="d-in">${skelLines(7)}</div></aside>`;root.hidden=false;loadDrawer();}
function fuItem(f,{showLead=true,compact=false}={}){
  const pend=f.status==="pendente";const when=pend?dueBadge(f.due_at):`<span class="due none">${fmtDT(f.due_at)}</span>`;
  const resched=f.history?.length?` · reagendado ${f.history.length}x`:"";
  return`<div class="fu${compact?" compact":""}">
    <div class="fu-when">${when}${!compact?`<small>${fmtDate(f.due_at)}</small>`:""}</div>
    <div class="fu-main">${showLead&&f.lead?`<button class="lead-link" data-act="openLead" data-id="${f.lead_id}">${esc(f.lead.name)}</button><div class="meta">${esc(f.lead.service)} · ${money(f.lead.value)}${resched}</div>`:`<div class="meta">${resched?resched.slice(3):""}</div>`}
      ${f.note?`<div class="fu-note">${esc(f.note)}</div>`:""}
      ${f.status==="concluido"?`<div class="meta">${icon("check",13)} Concluído em ${fmtDT(f.completed_at)}</div>`:""}
      ${f.status==="cancelado"?`<div class="meta">${esc(f.cancel_reason||"Cancelado")} · ${fmtDT(f.cancelled_at)}</div>`:""}</div>
    ${pend?`<div class="fu-act"><button class="btn sm" data-act="compose" data-id="${f.lead_id}" data-fu="${f.id}">${icon("chat",14)}Mensagem</button><button class="btn sm" data-act="completeFu" data-id="${f.id}">${icon("check",14)}Concluir</button><button class="btn sm ghost" data-act="reschedule" data-id="${f.id}" data-due="${f.due_at}">${icon("clock",14)}Reagendar</button><button class="btn sm ghost" data-act="cancelFu" data-id="${f.id}">${icon("x",14)}Cancelar</button></div>`
    :`<div class="fu-act"><span class="pill ${f.status==="concluido"?"ok":""}">${f.status==="concluido"?"Concluído":"Cancelado"}</span></div>`}
  </div>`;}
async function loadDrawer(){
  const id=state.drawerLead;const box=$("#drawer-root .drawer");if(!id||!box)return;
  try{
    const [l,fus,msgs]=await Promise.all([leadsSvc.get(id),fuSvc.forLead(id),msgSvc.list({lead_id:id})]);
    if(state.drawerLead!==id)return;
    const closed=CLOSED.includes(l.stage);
    box.innerHTML=`<div class="d-in">
      <div class="d-head"><div><div class="eyebrow">Lead${l.demo?" · fictício":""}</div><h2>${esc(l.name)}</h2><div class="meta">${esc(l.service)} · <b class="num">${money(l.value)}</b></div></div><button class="icon-btn" data-act="closeDrawer" aria-label="Fechar">${icon("x")}</button></div>
      <div class="d-actions"><button class="btn primary sm" data-act="compose" data-id="${l.id}" ${l.consent?"":"disabled"}>${icon("chat",14)}Preparar mensagem</button><button class="btn sm" data-act="editLead" data-id="${l.id}">${icon("edit",14)}Editar</button>${closed?"":`<button class="btn sm ghost" data-act="newFollowup" data-lead="${l.id}">${icon("calendar",14)}Agendar contato</button>`}</div>
      ${l.consent?"":`<div class="warn-box">${icon("alert",16)}<span>Sem autorização registrada para mensagens. Edite o lead para registrar como o paciente autorizou o contato.</span></div>`}
      <div class="field"><label for="dStage">Etapa comercial</label><select class="input" id="dStage">${STAGES.map(s=>`<option value="${s.id}" ${l.stage===s.id?"selected":""}>${s.label}</option>`).join("")}</select></div>
      <dl class="kv">
        <dt>Telefone</dt><dd><span class="selectable">${fmtPhone(l.phone)}</span> <button class="link-btn" data-act="copyPhone" data-v="${fmtPhone(l.phone)}">Copiar</button></dd>
        <dt>Autorização</dt><dd>${l.consent?`Sim, desde ${fmtDate(l.consent_at)}<br><span class="muted">${esc(l.consent_source||"")}</span>`:"Não registrada"}</dd>
        <dt>Próximo contato</dt><dd>${closed?"Encerrado":dueBadge(l.next_contact)}</dd>
        <dt>Cadastrado em</dt><dd>${fmtDate(l.created_at)}</dd>
        ${l.converted_at?`<dt>Convertido em</dt><dd>${fmtDate(l.converted_at)}</dd>`:""}${l.lost_at?`<dt>Perdido em</dt><dd>${fmtDate(l.lost_at)}</dd>`:""}
        ${l.notes?`<dt>Observações</dt><dd>${esc(l.notes)}</dd>`:""}
      </dl>
      <div class="d-sec"><div class="sec-row"><h3>Acompanhamentos</h3><span class="hint">${fus.filter(f=>f.status==="pendente").length} pendente(s)</span></div>
        ${fus.length?fus.map(f=>fuItem(f,{showLead:false,compact:true})).join(""):`<p class="muted">Nenhum acompanhamento registrado.</p>`}</div>
      <div class="d-sec"><div class="sec-row"><h3>Mensagens preparadas</h3><span class="hint">${msgs.length}</span></div>
        ${msgs.length?msgs.slice(0,5).map(m=>`<div class="msg-item"><div class="mi-h"><span>${fmtDT(m.created_at)} · ${esc(m.template_name)}</span><span class="pill">${ACTION_LABEL[m.action]}</span></div><p>${esc(m.body)}</p></div>`).join(""):`<p class="muted">Nenhuma mensagem preparada para este lead.</p>`}</div>
    </div>`;
    $("#dStage",box).addEventListener("change",e=>moveStage(l.id,e.target.value,e.target,l.stage));
  }catch(err){box.innerHTML=`<div class="d-in"><div class="d-head"><span></span><button class="icon-btn" data-act="closeDrawer" aria-label="Fechar">${icon("x")}</button></div>${errorBox(err)}</div>`;const b=$("[data-retry]",box);if(b)b.onclick=loadDrawer;}
}
async function moveStage(id,stage,ctrl,prev){
  if(stage===prev)return;
  if(CLOSED.includes(stage)){const n=(await fuSvc.forLead(id).catch(()=>[])).filter(f=>f.status==="pendente").length;
    if(n){const ok=await confirmDialog({title:`Marcar como ${stageLabel(stage).toLowerCase()}?`,body:`${n} acompanhamento(s) pendente(s) deste lead serão cancelados.`,ok:`Marcar como ${stageLabel(stage).toLowerCase()}`});if(!ok){if(ctrl)ctrl.value=prev;return;}}}
  try{if(ctrl)ctrl.disabled=true;const r=await leadsSvc.setStage(id,stage);toast(`${r.lead.name}: ${stageLabel(stage)}.`+(r.cancelled?` ${r.cancelled} acompanhamento(s) cancelado(s).`:""));refresh();}
  catch(err){if(ctrl){ctrl.value=prev;ctrl.disabled=false;}toast(err.message,"err");}
}

/* ---------------- Pipeline ---------------- */
async function pagePipeline(el,{quiet}={}){
  const tk=++renderToken;
  if(!quiet)el.innerHTML=head("Pipeline","Arraste os cartões entre as etapas ou use o seletor de cada cartão.",`<button class="btn primary" data-act="newLead">${icon("plus")}Novo lead</button>`)+`<div id="board">${skelLines(5)}</div>`;
  const box=$("#board",el);
  try{
    const L=await leadsSvc.list({});if(tk!==renderToken)return;
    box.innerHTML=`<div class="board">${STAGES.map(s=>{const items=L.filter(l=>l.stage===s.id);const sum=items.reduce((a,l)=>a+(l.value||0),0);
      return`<section class="k-col" data-stage="${s.id}" aria-label="${s.label}"><div class="k-head">${stageBadge(s.id)}<span class="k-sum">${items.length} · ${money0(sum)}</span></div>
      ${items.length?items.map(l=>`<article class="k-card" draggable="true" data-id="${l.id}" data-stage="${l.stage}" data-act="openLead" tabindex="0">
        <div class="k-n">${esc(l.name)}</div>
        <div class="k-meta"><span>${esc(l.service)}</span><span class="k-val">${money0(l.value)}</span></div>
        ${CLOSED.includes(l.stage)?"":dueBadge(l.next_contact)}
        <select class="input" data-move="${l.id}" aria-label="Mover ${esc(l.name)} para outra etapa">${STAGES.map(o=>`<option value="${o.id}" ${o.id===l.stage?"selected":""}>${o.id===l.stage?"Mover para…":o.label}</option>`).join("")}</select>
      </article>`).join(""):`<div class="k-empty">Nenhum lead nesta etapa</div>`}</section>`;}).join("")}</div>`;
    $$(".k-card",box).forEach(c=>{c.addEventListener("dragstart",e=>{e.dataTransfer.setData("text/plain",c.dataset.id);e.dataTransfer.effectAllowed="move";c.classList.add("dragging");});c.addEventListener("dragend",()=>c.classList.remove("dragging"));});
    $$(".k-col",box).forEach(col=>{col.addEventListener("dragover",e=>{e.preventDefault();col.classList.add("over");});col.addEventListener("dragleave",e=>{if(!col.contains(e.relatedTarget))col.classList.remove("over");});
      col.addEventListener("drop",e=>{e.preventDefault();col.classList.remove("over");const id=e.dataTransfer.getData("text/plain");const card=$(`.k-card[data-id="${id}"]`,box);if(card)moveStage(id,col.dataset.stage,null,card.dataset.stage);});});
  }catch(err){if(tk===renderToken)showError(box,err,()=>pagePipeline(el));}
}

/* ---------------- Agenda ---------------- */
async function pageAgenda(el,{quiet}={}){
  const tab=state.agendaTab;
  if(!quiet)el.innerHTML=head("Agenda","Acompanhamentos comerciais marcados pela equipe.",`<button class="btn primary" data-act="newFollowup">${icon("plus")}Novo acompanhamento</button>`)+`
    <div class="seg" role="tablist">${[["pendente","Pendentes"],["concluido","Concluídos"],["cancelado","Cancelados"]].map(([k,l])=>`<button role="tab" aria-selected="${k===tab}" class="seg-btn${k===tab?" on":""}" data-act="agendaTab" data-tab="${k}">${l}</button>`).join("")}</div>
    <div id="agendaList" class="stack">${skelLines(5)}</div>`;
  const box=$("#agendaList",el);const tk=++renderToken;
  try{
    const list=await fuSvc.list(tab);if(tk!==renderToken)return;
    if(!list.length){box.innerHTML=`<div class="card">${tab==="pendente"?empty({ic:"calendar",title:"Nenhum acompanhamento pendente",text:"Agende o próximo contato de cada orçamento em aberto para não perder o momento certo.",action:`<button class="btn primary" data-act="newFollowup">${icon("plus")}Novo acompanhamento</button>`}):empty({ic:"calendar",title:tab==="concluido"?"Nenhum acompanhamento concluído":"Nenhum acompanhamento cancelado"})}</div>`;return;}
    if(tab!=="pendente"){box.innerHTML=`<div class="group">${list.map(f=>fuItem(f)).join("")}</div>`;return;}
    const G=[["Atrasados",n=>n<0,"late"],["Hoje",n=>n===0],["Amanhã",n=>n===1],["Próximos 7 dias",n=>n>=2&&n<=7],["Mais adiante",n=>n>7]];
    box.innerHTML=G.map(([t,fn,c])=>{const items=list.filter(f=>fn(dayDiff(f.due_at)));return items.length?`<section class="group"><div class="group-h ${c||""}">${t} <span class="num">· ${items.length}</span></div>${items.map(f=>fuItem(f)).join("")}</section>`:"";}).join("");
  }catch(err){if(tk===renderToken)showError(box,err,()=>pageAgenda(el));}
}
async function openFollowupForm(leadId){
  openModal({title:"Novo acompanhamento",body:skelLines(4)});
  try{
    const L=(await leadsSvc.list({})).filter(l=>!CLOSED.includes(l.stage));
    if(!L.length){openModal({title:"Novo acompanhamento",body:empty({ic:"users",title:"Nenhum lead em aberto",text:"Cadastre um lead para agendar o primeiro contato.",action:`<button class="btn primary" data-act="newLead">${icon("plus")}Novo lead</button>`})});return;}
    const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);
    openModal({title:"Novo acompanhamento",
      body:`<form class="form" id="fuForm" novalidate>
        <div class="field"><label for="fuLead">Lead</label><select class="input" id="fuLead" name="lead_id"><option value="">Selecione</option>${L.map(l=>`<option value="${l.id}" ${l.id===leadId?"selected":""}>${esc(l.name)} · ${esc(l.service)}</option>`).join("")}</select></div>
        <div class="grid2"><div class="field"><label for="fuDate">Data</label><input class="input" type="date" id="fuDate" name="date" min="${isoDate(new Date())}" value="${isoDate(tomorrow)}"></div><div class="field"><label for="fuTime">Horário</label><input class="input" type="time" id="fuTime" name="time" value="10:00"></div></div>
        <div class="field"><label for="fuNote">O que tratar neste contato</label><textarea class="input" id="fuNote" name="note" rows="2" placeholder="Ex.: reforçar condição de parcelamento"></textarea></div>
      </form>`,
      footer:`<button class="btn ghost" data-act="closeModal">Cancelar</button><button class="btn primary" type="submit" form="fuForm">Agendar</button>`,
      onMount:root=>{const form=$("#fuForm",root);form.addEventListener("submit",async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(form));
        try{await busy($('button[form="fuForm"]'),()=>fuSvc.create(d));closeModal();toast(`Contato agendado para ${fmtDate(d.date+"T"+d.time)}, ${d.time}.`);refresh();}catch(err){showErrors(form,err);}});}});
  }catch(err){$("#modal-root .m-body").innerHTML=errorBox(err);const b=$("#modal-root [data-retry]");if(b)b.onclick=()=>openFollowupForm(leadId);}
}
function openReschedule(id,due){
  openModal({title:"Reagendar acompanhamento",size:"sm",
    body:`<form class="form" id="rsForm" novalidate><p class="muted">Data atual: ${fmtDT(due)}</p><div class="grid2"><div class="field"><label for="rsDate">Nova data</label><input class="input" type="date" id="rsDate" name="date" min="${isoDate(new Date())}" value="${dayDiff(due)<0?isoDate(new Date()):due.slice(0,10)}"></div><div class="field"><label for="rsTime">Horário</label><input class="input" type="time" id="rsTime" name="time" value="${fmtTime(due)}"></div></div></form>`,
    footer:`<button class="btn ghost" data-act="closeModal">Cancelar</button><button class="btn primary" type="submit" form="rsForm">Reagendar</button>`,
    onMount:root=>{const form=$("#rsForm",root);form.addEventListener("submit",async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(form));
      try{const f=await busy($('button[form="rsForm"]'),()=>fuSvc.reschedule(id,d.date,d.time));closeModal();toast(`Reagendado para ${fmtDT(f.due_at)}.`);refresh();}catch(err){showErrors(form,err);}});}});
}

/* ---------------- Mensagens ---------------- */
async function pageMensagens(el,{quiet}={}){
  const f=state.msgFilters;
  if(!quiet){
    el.innerHTML=head("Mensagens","Histórico das mensagens preparadas pela equipe para o WhatsApp.",`<button class="btn primary" data-act="pickLead">${icon("plus")}Nova mensagem</button>`)+`
    <div class="info-box">${icon("info",16)}<span>Nesta versão o Retoma não envia mensagens. O histórico registra quando um texto foi copiado ou quando o link do WhatsApp foi acionado; a entrega só poderá ser confirmada depois da conexão com a WhatsApp Business Platform.</span></div>
    <div class="toolbar"><label class="search"><span class="sr">Buscar mensagens</span>${icon("search",16)}<input class="input" id="mQ" type="search" placeholder="Buscar por lead, modelo ou texto" value="${esc(f.q)}"></label>
      <select class="input" id="mAct" aria-label="Filtrar por ação">${[["","Todas as ações"],["copiada","Copiadas"],["whatsapp","Link do WhatsApp acionado"]].map(([v,l])=>`<option value="${v}" ${f.action===v?"selected":""}>${l}</option>`).join("")}</select></div>
    <div id="msgList"></div>`;
    $("#mQ").addEventListener("input",e=>{clearTimeout(qTimer);qTimer=setTimeout(()=>{f.q=e.target.value;loadMsgs();},220);});
    $("#mAct").addEventListener("change",e=>{f.action=e.target.value;loadMsgs();});
  }
  loadMsgs(quiet);
}
async function loadMsgs(quiet){
  const box=$("#msgList");if(!box)return;const tk=++renderToken;const f=state.msgFilters;
  if(!quiet)box.innerHTML=skelLines(5);
  try{const M=await msgSvc.list(f);if(tk!==renderToken)return;
    if(!M.length){box.innerHTML=`<div class="card">${f.q||f.action?empty({ic:"search",title:"Nenhuma mensagem encontrada",text:"Ajuste a busca ou o filtro de ação."}):empty({ic:"chat",title:"Nenhuma mensagem preparada ainda",text:"Prepare uma mensagem a partir de um lead ou da agenda. Ela aparece aqui quando for copiada ou aberta no WhatsApp.",action:`<button class="btn primary" data-act="pickLead">${icon("plus")}Nova mensagem</button>`})}</div>`;return;}
    box.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Data</th><th>Lead</th><th>Modelo</th><th>Mensagem</th><th>Ação registrada</th><th>Entrega</th></tr></thead><tbody>
    ${M.map(m=>`<tr><td class="num" style="white-space:nowrap">${fmtDT(m.created_at)}<span class="sub">${esc(m.by)}</span></td><td>${m.lead?`<button class="lead-link" data-act="openLead" data-id="${m.lead_id}">${esc(m.lead.name)}</button>`:"<span class='muted'>Lead removido</span>"}</td><td>${esc(m.template_name)}</td><td><span class="clamp">${esc(m.body)}</span></td><td><span class="pill ${m.action==="whatsapp"?"accent":""}">${ACTION_LABEL[m.action]}</span></td><td><span class="pill" title="Sem integração com a API, a entrega não pode ser confirmada">Não confirmada</span></td></tr>`).join("")}
    </tbody></table></div>`;
  }catch(err){if(tk===renderToken)showError(box,err,()=>loadMsgs());}
}
async function openLeadPicker(){
  openModal({title:"Nova mensagem",body:skelLines(4)});
  try{const L=await leadsSvc.list({});
    if(!L.length){openModal({title:"Nova mensagem",body:empty({ic:"users",title:"Nenhum lead cadastrado",text:"Cadastre um lead antes de preparar mensagens.",action:`<button class="btn primary" data-act="newLead">${icon("plus")}Novo lead</button>`})});return;}
    openModal({title:"Para quem é a mensagem?",
      body:`<div class="form"><label class="search"><span class="sr">Buscar lead</span>${icon("search",16)}<input class="input" id="pkQ" type="search" placeholder="Buscar lead"></label><div class="rows" id="pkList"></div></div>`,
      onMount:root=>{const draw=q=>{const n=norm(q);const items=L.filter(l=>!n||norm(l.name).includes(n)||norm(l.service).includes(n));
        $("#pkList",root).innerHTML=items.length?items.map(l=>`<div class="row"><div class="r-main"><strong>${esc(l.name)}</strong><span>${esc(l.service)} · ${stageLabel(l.stage)}</span></div><div class="r-act">${l.consent?`<button class="btn sm" data-act="compose" data-id="${l.id}">Escolher</button>`:`<span class="consent no">${icon("alert",14)}Sem autorização</span>`}</div></div>`).join(""):`<p class="muted">Nenhum lead encontrado.</p>`;};
        draw("");$("#pkQ",root).addEventListener("input",e=>draw(e.target.value));}});
  }catch(err){$("#modal-root .m-body").innerHTML=errorBox(err);}
}

/* ---------------- Composer ---------------- */
async function openComposer(leadId,fuId){
  closeModal();openModal({title:"Preparar mensagem",size:"lg",body:skelLines(5)});
  try{
    const [lead,me,T]=await Promise.all([leadsSvc.get(leadId),clinicSvc.me(),msgSvc.templates()]);const clinic=me.clinic;
    let tpl=T[0]||null;
    const fill=t=>t?renderTemplate(t.body,lead,clinic).text:`Olá, ${lead.name.split(/\s+/)[0]}! `;
    openModal({title:"Preparar mensagem",size:"lg",
      body:`<div class="comp">
        <div class="comp-to"><span class="muted">Para</span><strong>${esc(lead.name)}</strong><span class="selectable">${fmtPhone(lead.phone)}</span><button class="link-btn" data-act="copyPhone" data-v="${fmtPhone(lead.phone)}">Copiar número</button><span style="margin-left:auto">${stageBadge(lead.stage)}</span></div>
        ${lead.consent?"":`<div class="warn-box">${icon("alert",16)}<span><strong>Sem autorização para mensagens.</strong> Registre no cadastro como o paciente autorizou o contato antes de escrever para ele.</span></div>`}
        ${T.length?`<div class="field"><span class="lbl">Modelo</span><div class="tpls" role="group" aria-label="Modelos">${T.map((t,i)=>`<button type="button" class="tpl" data-tpl="${t.id}" aria-pressed="${i===0}">${esc(t.name)}</button>`).join("")}<button type="button" class="tpl" data-tpl="" aria-pressed="false">Mensagem livre</button></div></div>`:""}
        <div class="field"><label for="cBody">Mensagem</label><textarea class="input" id="cBody" rows="6">${esc(fill(tpl))}</textarea>
          <div class="comp-meta"><span class="hint">Edite à vontade antes de copiar.</span><span class="hint num" id="cCount"></span></div></div>
        <div class="warn-box" id="cWarn" hidden>${icon("alert",16)}<span id="cWarnT"></span></div>
        <div class="after" id="cAfter" hidden></div>
        <p class="hint">O Retoma não envia a mensagem. Copie o texto ou abra a conversa no WhatsApp e envie por lá. Se o link não abrir, copie o número acima.</p>
      </div>`,
      footer:`<button class="btn ghost" data-act="closeModal">Fechar</button><button class="btn" id="cCopy">${icon("copy",16)}Copiar mensagem</button><a class="btn primary" id="cWa" target="_blank" rel="noopener">${icon("send",16)}Abrir no WhatsApp</a>`,
      onMount:root=>{
        const ta=$("#cBody",root),copyB=$("#cCopy",root),wa=$("#cWa",root);
        const sync=()=>{const t=ta.value.trim();const left=[...t.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map(m=>m[1]);
          $("#cCount",root).textContent=`${t.length} caracteres`;
          let warn="";if(left.length)warn=`Substitua ${left.map(k=>`{{${k}}}`).join(", ")} antes de usar. ${left.includes("valor")?"Informe o valor do orçamento no cadastro do lead.":left.includes("atendente")?"Defina quem assina as mensagens em Configurações.":""}`;else if(!t)warn="Escreva a mensagem.";
          $("#cWarn",root).hidden=!warn;$("#cWarnT",root).textContent=warn;
          const off=!lead.consent||!!warn;copyB.disabled=off;wa.setAttribute("aria-disabled",off?"true":"false");wa.href=off?"#":waLink(lead.phone,t);};
        sync();ta.addEventListener("input",sync);
        $$(".tpl",root).forEach(b=>b.onclick=()=>{$$(".tpl",root).forEach(x=>x.setAttribute("aria-pressed","false"));b.setAttribute("aria-pressed","true");tpl=T.find(t=>t.id===b.dataset.tpl)||null;ta.value=fill(tpl);sync();});
        const after=async action=>{
          const body=ta.value.trim();
          try{await msgSvc.log({lead_id:lead.id,template_id:tpl?.id,template_name:tpl?.name||"Mensagem livre",body,action});}
          catch(err){toast((action==="copiada"?"Mensagem copiada, mas ":"")+"não foi possível registrar no histórico: "+err.message,"err");return;}
          const fu=fuId?{id:fuId}:null;
          const box=$("#cAfter",root);box.hidden=false;
          box.innerHTML=`<div><strong>${action==="copiada"?"Mensagem copiada e registrada no histórico.":"Registrado no histórico: link do WhatsApp acionado."}</strong><div class="hint">O envio não é confirmado pelo Retoma. Depois de enviar, atualize o andamento:</div></div>
            <div class="a-acts">${fu?`<button class="btn sm" data-after="done">${icon("check",14)}Concluir este acompanhamento</button>`:""}${["novo","orcamento"].includes(lead.stage)?`<button class="btn sm" data-after="stage">Mover para Aguardando retorno</button>`:""}<button class="btn sm ghost" data-after="schedule">${icon("calendar",14)}Agendar próximo contato</button></div>`;
          $$("[data-after]",box).forEach(b=>b.onclick=async()=>{
            try{if(b.dataset.after==="done"){await busy(b,()=>fuSvc.complete(fu.id),"…");toast("Acompanhamento concluído.");b.remove();}
              else if(b.dataset.after==="stage"){await busy(b,()=>leadsSvc.setStage(lead.id,"aguardando"),"…");lead.stage="aguardando";toast(`${lead.name}: Aguardando retorno.`);b.remove();}
              else{closeModal();openFollowupForm(lead.id);return;}
              refresh();}catch(err){toast(err.message,"err");}});
          refresh();
        };
        copyB.onclick=async()=>{const ok=await copyText(ta.value.trim(),ta);if(ok){toast("Mensagem copiada.");after("copiada");}else toast("Não foi possível copiar automaticamente. O texto foi selecionado: use Ctrl+C ou Copiar do sistema.","err");};
        wa.addEventListener("click",e=>{if(wa.getAttribute("aria-disabled")==="true"){e.preventDefault();return;}after("whatsapp");});
      }});
  }catch(err){$("#modal-root .m-body").innerHTML=errorBox(err);const b=$("#modal-root [data-retry]");if(b)b.onclick=()=>openComposer(leadId,fuId);}
}

/* ---------------- Configurações ---------------- */
async function pageConfig(el,{quiet}={}){
  const tk=++renderToken;
  if(!quiet)el.innerHTML=head("Configurações","Dados da clínica, modelos de mensagem e integrações.")+skelLines(6);
  try{
    const [me,T]=await Promise.all([clinicSvc.me(),msgSvc.templates()]);if(tk!==renderToken)return;
    const c=me.clinic;const demo=c.id===DEMO_ID;
    el.innerHTML=head("Configurações","Dados da clínica, modelos de mensagem e integrações.")+`<div class="set-grid">
    <section class="card"><div class="sec-head"><h2>Dados da clínica</h2></div><p class="sec-desc">Esses dados preenchem as variáveis {{clinica}} e {{atendente}} nas mensagens.</p>
      <form class="form" id="clinicForm" novalidate>
        <div class="grid2"><div class="field"><label for="cName">Nome da clínica</label><input class="input" id="cName" name="name" value="${esc(c.name)}"></div>
          <div class="field"><label for="cPhone">WhatsApp da clínica</label><input class="input" id="cPhone" name="phone" inputmode="tel" value="${esc(maskPhone(c.phone))}" data-mask="phone"></div></div>
        <div class="grid2"><div class="field"><label for="cAtt">Quem assina as mensagens</label><input class="input" id="cAtt" name="attendant" value="${esc(c.attendant||"")}"><span class="hint">Ex.: Carla, Equipe Lumiar</span></div>
          <div class="field"><label for="cMail">Conta</label><input class="input" id="cMail" value="${esc(me.user.email)}" disabled></div></div>
        <div class="field"><label for="cSvc">Serviços oferecidos</label><textarea class="input" id="cSvc" name="services" rows="4">${esc((c.services||[]).join("\n"))}</textarea><span class="hint">Um por linha. Aparecem como sugestão no cadastro de leads.</span></div>
        <div><button class="btn primary" type="submit">Salvar dados</button></div>
      </form></section>

    <section class="card"><div class="sec-head"><h2>Modelos de mensagem</h2><button class="btn sm" data-act="editTpl">${icon("plus",14)}Novo modelo</button></div>
      <p class="sec-desc">Use variáveis para personalizar cada mensagem: ${VARS.map(v=>`<code>{{${v.k}}}</code>`).join(" ")}.</p>
      ${T.length?`<div class="tpl-list">${T.map(t=>`<div class="tpl-item"><div class="t-b"><strong>${esc(t.name)}</strong><p>${esc(t.body)}</p></div><div style="display:flex;gap:4px;flex:none"><button class="icon-btn" data-act="editTpl" data-id="${t.id}" aria-label="Editar ${esc(t.name)}">${icon("edit",16)}</button><button class="icon-btn" data-act="delTpl" data-id="${t.id}" data-name="${esc(t.name)}" aria-label="Excluir ${esc(t.name)}">${icon("trash",16)}</button></div></div>`).join("")}</div>`
      :empty({ic:"file",title:"Nenhum modelo",text:"Crie modelos para agilizar os retornos da equipe."}).replace('class="empty"','class="empty sm"')}
    </section>

    <section class="card"><div class="sec-head"><h2>WhatsApp Business Platform</h2><span class="pill">${icon("circle",10)}Não conectado</span></div>
      <p class="sec-desc">A conexão oficial vai permitir enviar mensagens a partir do Retoma e receber da Meta as confirmações de envio, entrega e leitura. Até lá, a equipe copia o texto ou abre a conversa no WhatsApp e envia por lá.</p>
      <ul class="checklist">
        <li>${icon("circle",16)}<span>Conta no Meta Business verificada e conta do WhatsApp Business Platform criada</span></li>
        <li>${icon("circle",16)}<span>Número de telefone dedicado, registrado na plataforma</span></li>
        <li>${icon("circle",16)}<span>Modelos de mensagem aprovados pela Meta para contatos iniciados pela clínica fora da janela de 24 horas</span></li>
        <li class="done">${icon("check",16)}<span>Registro da autorização de cada paciente para receber mensagens (o Retoma já guarda isso por lead)</span></li>
      </ul>
      <dl class="tech"><dt>Token de acesso</dt><dd>Guardado apenas no servidor, em cofre de segredos. Nunca é enviado ao navegador.</dd><dt>Confirmações</dt><dd>Recebidas por webhook no servidor, que atualiza o status de entrega no histórico.</dd><dt>Isolamento</dt><dd>Cada clínica terá a própria conexão, vinculada à sua conta.</dd></dl>
      <button class="btn" disabled>${icon("lock",15)}Conectar conta (disponível em breve)</button>
    </section>

    <section class="card"><div class="sec-head"><h2>Sessão e dados de teste</h2></div>
      <p class="sec-desc">${demo?"Você está na clínica de demonstração. Os dados são fictícios e podem ser restaurados a qualquer momento.":"Ferramentas para testar como o Retoma se comporta quando algo dá errado."}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" data-act="failNext">${icon("alert",15)}Simular falha na próxima requisição</button>
        ${demo?`<button class="btn" data-act="resetDemo">${icon("refresh",15)}Restaurar dados de demonstração</button>`:""}
        <button class="btn ghost" data-act="logout">${icon("logout",15)}Sair</button>
      </div>
    </section></div>`;
    const form=$("#clinicForm",el);
    form.addEventListener("submit",async e=>{e.preventDefault();const fd=Object.fromEntries(new FormData(form));fd.services=[...new Set(String(fd.services).split("\n").map(s=>s.trim()).filter(Boolean))];
      try{await busy($("button[type=submit]",form),()=>clinicSvc.update(fd));clearErrors(form);toast("Dados da clínica salvos.");$("#meClinic").textContent=fd.name.trim();$("#meAv").textContent=initials(fd.name);}catch(err){showErrors(form,err);}});
  }catch(err){if(tk===renderToken)showError(el,err,()=>pageConfig(el));}
}
async function openTplForm(id){
  let t={name:"",body:""};
  if(id){try{t=(await msgSvc.templates()).find(x=>x.id===id)||t;}catch(err){toast(err.message,"err");return;}}
  const sample={name:"Ana Souza",service:"Toxina botulínica",value:1350};
  const clinic=state.me?.clinic||{name:"Sua clínica",attendant:"Equipe"};
  openModal({title:id?"Editar modelo":"Novo modelo",size:"lg",
    body:`<form class="form" id="tplForm" novalidate>
      <div class="field"><label for="tName">Nome do modelo</label><input class="input" id="tName" name="name" value="${esc(t.name)}" placeholder="Ex.: Retorno após 7 dias"></div>
      <div class="field"><label for="tBody">Mensagem</label><textarea class="input" id="tBody" name="body" rows="5">${esc(t.body)}</textarea>
        <span class="lbl" style="margin-top:4px">Inserir variável</span><div class="var-chips">${VARS.map(v=>`<button type="button" class="var-chip" data-var="${v.k}" title="${v.d}">{{${v.k}}}</button>`).join("")}</div></div>
      <div class="field"><span class="lbl">Prévia com um lead de exemplo</span><div class="preview" id="tPrev"></div></div>
    </form>`,
    footer:`<button class="btn ghost" data-act="closeModal">Cancelar</button><button class="btn primary" type="submit" form="tplForm">Salvar modelo</button>`,
    onMount:root=>{const ta=$("#tBody",root),prev=$("#tPrev",root);const upd=()=>{prev.textContent=renderTemplate(ta.value||"…",sample,clinic).text;};upd();ta.addEventListener("input",upd);
      $$(".var-chip",root).forEach(b=>b.onclick=()=>{const s=ta.selectionStart??ta.value.length,e=ta.selectionEnd??s;const ins=`{{${b.dataset.var}}}`;ta.value=ta.value.slice(0,s)+ins+ta.value.slice(e);ta.focus();ta.selectionStart=ta.selectionEnd=s+ins.length;upd();});
      const form=$("#tplForm",root);form.addEventListener("submit",async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(form));
        try{await busy($('button[form="tplForm"]'),()=>msgSvc.saveTemplate(id,d));closeModal();toast("Modelo salvo.");refresh();}catch(err){showErrors(form,err);}});}});
}

/* ---------------- ações globais ---------------- */
const ACT={
  nav:t=>go(t.dataset.r), openNav:()=>$(".app").classList.add("nav-open"), closeNav:()=>$(".app").classList.remove("nav-open"),
  toCadastro:()=>{state.route="cadastro";render();}, toLogin:()=>{state.route="login";render();}, toRecover:()=>{state.route="recuperar";render();},
  demo:async t=>{try{session=await busy(t,()=>authSvc.demo(),"Abrindo…");saveSession();state.route="dashboard";render();}catch(err){toast(err.message,"err");}},
  recheckAccess:async t=>{await busy(t,async()=>{await loadAccess(session);},"Verificando\u2026");if(session.access&&session.access.has_access){toast("Assinatura ativa. Bem-vinda ao Retoma!");state.route="dashboard";}else toast("Ainda n\u00e3o encontramos o pagamento para este e-mail.","err");render();},
  logout:async()=>{const ok=await confirmDialog({title:"Sair da conta?",body:"Você voltará para a tela de entrada.",ok:"Sair"});if(!ok)return;await authSvc.signOut();session=null;state.me=null;saveSession();closeDrawer();closeModal();state.route="login";render();},
  closeModal, closeDrawer,
  openLead:t=>openLead(t.dataset.id), newLead:()=>{closeModal();openLeadForm(null);}, editLead:t=>openLeadForm(t.dataset.id),
  compose:t=>openComposer(t.dataset.id,t.dataset.fu||null), pickLead:()=>openLeadPicker(),
  newFollowup:t=>{closeModal();openFollowupForm(t.dataset.lead||null);},
  reschedule:t=>openReschedule(t.dataset.id,t.dataset.due),
  completeFu:async t=>{try{await busy(t,()=>fuSvc.complete(t.dataset.id),"…");toast("Acompanhamento concluído.");refresh();}catch(err){toast(err.message,"err");}},
  cancelFu:async t=>{const ok=await confirmDialog({title:"Cancelar acompanhamento?",body:"Ele sai da agenda e fica registrado como cancelado.",ok:"Cancelar acompanhamento",danger:true});if(!ok)return;try{await fuSvc.cancel(t.dataset.id);toast("Acompanhamento cancelado.");refresh();}catch(err){toast(err.message,"err");}},
  agendaTab:t=>{state.agendaTab=t.dataset.tab;pageAgenda($("#page"));},
  clearLeadFilters:()=>{Object.keys(state.leadFilters).forEach(k=>state.leadFilters[k]="");pageLeads($("#page"));},
  copyPhone:async t=>{const ok=await copyText(t.dataset.v);toast(ok?"Número copiado.":"Não foi possível copiar. Selecione o número e copie manualmente.",ok?"":"err");},
  editTpl:t=>openTplForm(t.dataset.id||null),
  delTpl:async t=>{const ok=await confirmDialog({title:"Excluir modelo?",body:`O modelo “${esc(t.dataset.name)}” será excluído. Mensagens já registradas no histórico não mudam.`,ok:"Excluir",danger:true});if(!ok)return;try{await msgSvc.deleteTemplate(t.dataset.id);toast("Modelo excluído.");refresh();}catch(err){toast(err.message,"err");}},
  failNext:()=>{dev.failNext=true;toast("A próxima requisição vai falhar. Navegue ou salve algo para ver o tratamento de erro.");},
  resetDemo:async()=>{const ok=await confirmDialog({title:"Restaurar dados de demonstração?",body:"As alterações feitas na clínica de demonstração serão descartadas.",ok:"Restaurar"});if(!ok)return;seedDemo();toast("Dados de demonstração restaurados.");go("dashboard");}
};
document.addEventListener("click",e=>{const t=e.target.closest("[data-act]");if(!t||t.disabled)return;
  if(t.dataset.act==="openLead"&&e.target!==t&&e.target.closest("select,input,textarea,button:not([data-act='openLead']),a"))return;
  const fn=ACT[t.dataset.act];if(fn){if(t.tagName==="BUTTON"&&t.type!=="submit")e.preventDefault();fn(t,e);}});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"){if(confirmDone)return confirmDone(false);if(!$("#modal-root").hidden)return closeModal();if(!$("#drawer-root").hidden)return closeDrawer();$(".app")?.classList.remove("nav-open");}
  if(e.key==="Enter"&&e.target.matches("[data-act][tabindex]"))ACT[e.target.dataset.act]?.(e.target,e);});
document.addEventListener("change",e=>{const s=e.target.closest("[data-move]");if(s){const card=s.closest(".k-card");moveStage(s.dataset.move,s.value,s,card?card.dataset.stage:null);}});
document.addEventListener("input",e=>{const m=e.target.dataset?.mask;if(m==="phone"){e.target.value=maskPhone(e.target.value);}});
document.addEventListener("focusout",e=>{if(e.target.dataset?.mask==="money"){const v=parseMoney(e.target.value);e.target.value=v==null?"":moneyInput(v);}});

/* ---------------- boot ---------------- */
async function boot(){
  $("#app").innerHTML=`<div style="min-height:100%;display:grid;place-items:center;color:var(--muted)"><div style="display:flex;gap:10px;align-items:center"><span class="spin"></span>Carregando o Retoma…</div></div>`;
  loadDB();
  const isRecovery=/type=recovery/.test(location.hash);
  const h0=(location.hash||"").slice(1);if(ROUTES[h0]||h0==="cadastro")state.route=h0;
  let s=null;try{const raw=localStorage.getItem(SESSION_KEY);if(raw){const p=JSON.parse(raw);if(p&&p.mode==="demo"&&db.clinics.some(c=>c.id===p.clinicId))s=p;}}catch(e){}
  if(window.supabase){
    try{sb().auth.onAuthStateChange(ev=>{
      if(ev==="PASSWORD_RECOVERY"){state.recovery=true;if(!session||session.mode==="remote"){session=null;render();}}
      if(ev==="SIGNED_OUT"&&session&&session.mode==="remote"){session=null;render();}
    });}catch(e){}
    if(!s){if(isRecovery){await sb().auth.getSession().catch(()=>{});state.recovery=true;}else s=await authSvc.restore();}
  }
  if(!s&&/^#demo$/.test(location.hash)){try{s=await authSvc.demo();saveSession();}catch(e){}}
  session=await loadAccess(s);render();
}
boot();
