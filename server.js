// SportScope - zero-dependency server (Node 18+):  node server.js
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),zlib=require('zlib');
const PORT=process.env.PORT||3000,DB=path.join(__dirname,'data.json'),PUB=path.join(__dirname,'public'),SITE='SportScope';
const LEAGUES=['الدوري المصري','الدوري السعودي','دوري أبطال أوروبا','الدوري الإنجليزي','الدوري الإسباني','الدوري الإيطالي','كأس العالم'];
const CATS=['كرة القدم','ميركاتو','كرة السلة','التنس',...LEAGUES];
const hash=(p,s)=>crypto.scryptSync(p,s,32).toString('hex');
const save=d=>fs.writeFileSync(DB,JSON.stringify(d,null,1));
function load(){
  if(fs.existsSync(DB)){const o=JSON.parse(fs.readFileSync(DB));o.videos??=[];o.standings??=[];o.users??=[];o.about??=[{id:1,title:'من نحن',body:'SportScope موقع رياضي يقدم آخر الأخبار والنتائج وترتيب البطولات.',email:'info@example.com'}];o.siteSettings??=[{id:1,logo:''}];(o.articles||[]).forEach(a=>{a.imageAlt??='';a.seoTitle??='';a.seoDescription??='';a.focusKeyword??='';});return o}
  const salt=crypto.randomBytes(16).toString('hex');
  const d={admin:{user:process.env.ADMIN_USER||'mohammed',salt,hash:hash(process.env.ADMIN_PASS||'Admin100#',salt)},nextId:200,users:[],videos:[],
   articles:['كرة القدم','الدوري المصري','الدوري السعودي','دوري أبطال أوروبا','ميركاتو','كرة السلة','التنس','كرة القدم'].map((c,i)=>({id:i+1,title:'خبر تجريبي رقم '+(i+1)+' في '+c,category:c,image:'',
     body:'هذا نص تجريبي للخبر. يمكنك تعديله أو حذفه من لوحة التحكم.\nاكتب هنا تفاصيل الخبر الكاملة.',imageAlt:'',seoTitle:'',seoDescription:'',focusKeyword:'',date:new Date(Date.now()-i*36e5).toISOString(),views:100-i*7})),
   standings:[['الدوري المصري','الأهلي',25],['الدوري المصري','الزمالك',23],['الدوري السعودي','الهلال',27],['الدوري السعودي','النصر',25]].map((x,i)=>({id:101+i,league:x[0],team:x[1],p:'10',w:'8',d:'1',l:'1',pts:String(x[2])})),
   matches:[{id:1,league:'الدوري المصري',home:'الأهلي',away:'الزمالك',hs:2,as:1,time:'اليوم 20:00',startAt:new Date(Date.now()-2*3600000).toISOString(),status:'انتهت'},{id:2,league:'الدوري السعودي',home:'الهلال',away:'النصر',hs:'',as:'',time:'اليوم 22:00',startAt:new Date(Date.now()+6*3600000).toISOString(),status:'لم تبدأ'}]};
  save(d);return d;
}
let db=load();db.matches=(db.matches||[]).map(x=>{let start=x.startAt||'';if(!start&&/اليوم\s+\d{1,2}:\d{2}/.test(String(x.time||''))){const tm=String(x.time).match(/(\d{1,2}):(\d{2})/);const d=new Date();d.setHours(+tm[1],+tm[2],0,0);start=d.toISOString()}return {...x,startAt:start}});const sessions=new Map(),usess=new Map(),tries=new Map(),viewSeen=new Map();
const getCookie=(req,name)=>((req.headers.cookie||'').split(';').map(s=>s.trim().split('='))).find(([k])=>k===name)?.[1]||'';
const visitorId=req=>getCookie(req,'ss_vid');
const isBot=req=>/(bot|crawler|spider|slurp|bingpreview|facebookexternalhit|headless)/i.test(req.headers['user-agent']||'');
const countArticleView=(req,res,a)=>{if(isBot(req))return;let vid=visitorId(req);if(!vid){vid=crypto.randomBytes(12).toString('hex');res.setHeader('Set-Cookie',`ss_vid=${vid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${req.headers['x-forwarded-proto']==='https'?'; Secure':''}`)}const key=vid+':'+a.id,now=Date.now(),last=viewSeen.get(key)||0;if(now-last<30*60*1000)return;viewSeen.set(key,now);a.views=Number(a.views||0)+1;save(db);};
const SCHEMA={articles:['title','category','image','imageAlt','seoTitle','seoDescription','focusKeyword','body'],matches:['league','home','away','hs','as','time','startAt','status'],videos:['title','url','image'],standings:['league','team','p','w','d','l','pts'],about:['title','body','email'],siteSettings:['logo']};
const clean=(o,keys)=>Object.fromEntries(keys.map(k=>[k,String(o[k]??'').slice(0,k==='body'?20000:300)]));
const send=(res,c,o)=>{res.writeHead(c,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(o))};
const body=req=>new Promise(r=>{let b='';req.on('data',c=>{b+=c;if(b.length>1e6)req.destroy()});req.on('end',()=>{try{r(b.trim().startsWith('{')?JSON.parse(b):Object.fromEntries(new URLSearchParams(b)))}catch{r({})}})});
const authed=req=>{const e=sessions.get((req.headers.authorization||'').replace('Bearer ',''));return e&&e>Date.now()};
const limited=(k,max,ms)=>{const t=tries.get(k)||{n:0,until:0};if(t.until>Date.now())return true;t.n++;if(t.n>=max){t.n=0;t.until=Date.now()+ms}tries.set(k,t);return false};
const mime={'.css':'text/css','.js':'text/javascript','.html':'text/html; charset=utf-8','.png':'image/png','.ico':'image/x-icon','.svg':'image/svg+xml'};
const UP=path.join(PUB,'uploads'); if(!fs.existsSync(UP))fs.mkdirSync(UP,{recursive:true});
const parseMultipart=async(req)=>{
  const ct=req.headers['content-type']||'',m=ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if(!m)return {};
  const boundary=Buffer.from('--'+(m[1]||m[2])),chunks=[];let total=0;
  for await(const c of req){total+=c.length;if(total>12e6)throw Error('الملف كبير جدًا');chunks.push(c)}
  const buf=Buffer.concat(chunks),out={};
  let pos=0;
  while((pos=buf.indexOf(boundary,pos))!==-1){
    const start=pos+boundary.length;if(buf[start]===45)break;
    const hs=start+(buf[start]===13&&buf[start+1]===10?2:0),hend=buf.indexOf(Buffer.from('\r\n\r\n'),hs);
    if(hend<0)break;
    const headers=buf.slice(hs,hend).toString('utf8'),end=buf.indexOf(boundary,hend+4);
    if(end<0)break;
    const dataEnd=end-2,data=buf.slice(hend+4,dataEnd);
    const nm=headers.match(/name="([^"]+)"/i),fm=headers.match(/filename="([^"]*)"/i);
    if(nm){
      const name=nm[1];
      if(fm&&fm[1]){
        const filename=path.basename(fm[1]),ext=path.extname(filename).toLowerCase();
        const allowed={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif'};
        const typ=(headers.match(/Content-Type:\s*([^\r\n]+)/i)||[])[1]?.trim();
        if(!allowed[ext]||typ!==allowed[ext])throw Error('يسمح فقط بصور JPG أو PNG أو WEBP أو GIF');
        const safe=crypto.randomBytes(12).toString('hex')+ext,fp=path.join(UP,safe);
        fs.writeFileSync(fp,data);out[name]='/uploads/'+safe;
      }else out[name]=data.toString('utf8');
    }
    pos=end;
  }
  return out;
};


// ---------- helpers for HTML pages ----------
const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const H=u=>E(encodeURI(u));
const slug=t=>t.trim().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'').slice(0,80);
const aurl=a=>`/news/${a.id}-${slug(a.title)}`;
const D=d=>new Date(d).toLocaleDateString('ar-EG',{day:'numeric',month:'long',year:'numeric'});
const isImg=a=>/^(?:https?:\/\/|\/)/.test(String(a.image||''));
const absImg=(req,img)=>{const v=String(img||'');return /^https?:\/\//.test(v)?v:(v.startsWith('/')?base(req)+v:'')};
const arts=()=>[...db.articles].sort((a,b)=>b.date.localeCompare(a.date));
const base=req=>process.env.SITE_URL||((req.headers['x-forwarded-proto']||'http')+'://'+req.headers.host);
const ld=o=>`<script type="application/ld+json">${JSON.stringify(o).replace(/</g,'\\u003c')}</script>`;
const tile=(a,c='')=>`<a class="tile ${c}" href="${H(aurl(a))}">${isImg(a)?`<img src="${E(a.image)}" alt="${E(a.imageAlt||a.title)}" loading="lazy">`:''}<span><em>${E(a.category)}</em><br>${E(a.title)}</span></a>`;
const card=a=>`<a class="card" href="${H(aurl(a))}">${isImg(a)?`<img class="im" src="${E(a.image)}" alt="${E(a.imageAlt||a.title)}" loading="lazy">`:'<div class="im"></div>'}<div class="t">${E(a.title)}<small>${E(a.category)} • <time datetime="${E(a.date)}">${D(a.date)}</time></small></div></a>`;
const matchState=x=>{if(!x.startAt)return 'لم تبدأ';const t=new Date(x.startAt).getTime(),now=Date.now();if(now<t)return 'لم تبدأ';if(now<t+2*3600000)return 'مباشر';return 'انتهت'};
const mrow=x=>{const state=matchState(x),score=(x.hs!==''||x.as!=='')?`${E(x.hs??'')} <i>−</i> ${E(x.as??'')}`:'<i>VS</i>';return `<a class="match-card match-card-clean ${leagueClass(x.league)}" href="/match/${E(x.id)}"><div class="match-card-head"><span class="match-league-name">${E(x.league)}</span><span class="match-status-pill">${E(state)}</span></div><div class="match-date">${E(matchLabel(x))}</div><div class="match-teams-row"><span class="match-team home">${E(x.home)}</span><strong class="match-score">${score}</strong><span class="match-team away">${E(x.away)}</span></div><div class="match-card-bottom"><strong class="match-countdown" data-start="${E(x.startAt||'')}">${countdownLabel(x)}</strong><span>التفاصيل ←</span></div></a>`};
const matchLabel=x=>x.startAt?new Date(x.startAt).toLocaleString('ar-EG',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):String(x.time||'');
const countdownLabel=x=>{if(!x.startAt)return 'موعد المباراة غير محدد';const t=new Date(x.startAt).getTime()-Date.now();return t>0?'متبقي '+fmtCountdown(t):matchState(x)==='مباشر'?'مباشر الآن':'انتهت المباراة'};
const fmtCountdown=ms=>{ms=Math.max(0,ms);const s=Math.floor(ms/1000),d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60),sec=s%60;return (d?d+' يوم ':'')+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0')};
const embed=u=>{const m=String(u).match(/(?:youtu\.be\/|v=|embed\/)([\w-]{11})/);return m?'https://www.youtube-nocookie.com/embed/'+m[1]:''};
const NAV=[['/','الرئيسية'],['/news','الأخبار'],['/matches','المباريات'],['/leagues','البطولات'],['/videos','فيديو'],['/about','من نحن']];
const leagueClass=l=>({'الدوري المصري':'egypt','الدوري السعودي':'saudi','دوري أبطال أوروبا':'champions','الدوري الإنجليزي':'england','الدوري الإسباني':'spain','الدوري الإيطالي':'italy','كأس العالم':'world'}[l]||'default');
const siteLogo=req=>absImg(req,db.siteSettings?.[0]?.logo||'');

function page(req,o,user,main,aside=true){
  const b=base(req),path_=o.path||'/',url=b+encodeURI(path_);
  const title=o.title?`${o.title} | ${SITE}`:`${SITE} - أخبار الرياضة ونتائج المباريات`;
  const desc=E((o.desc||'تابع آخر أخبار كرة القدم والرياضة العربية والعالمية، نتائج المباريات، ترتيب الدوريات وأحدث الفيديوهات على SportScope.').replace(/\s+/g,' ').slice(0,160));
  const img=o.image?absImg(req,o.image):'';
  const logo=siteLogo(req);
  const globalLd=[{'@context':'https://schema.org','@type':'WebSite','name':SITE,'url':b+'/',inLanguage:'ar',...(logo?{logo}:{})},{'@context':'https://schema.org','@type':'Organization','name':SITE,'url':b+'/about',...(logo?{logo}:{})}].concat(o.ld||[]);
  const m=db.matches.slice(0,8).map(x=>`<a class="m match-card" href="/match/${E(x.id)}"><small>${E(x.league)} • ${E(matchLabel(x))}</small><b>${E(x.home)} ${E(x.hs||'')} ${x.hs!==''||x.as!==''?'-':''} ${E(x.as||'')} ${E(x.away)}</b><small class="match-status">${E(matchState(x))}</small><strong class="match-countdown" data-start="${E(x.startAt||'')}">${countdownLabel(x)}</strong></a>`).join('');
  const top=[...db.articles].filter(a=>Number(a.views||0)>0).sort((a,b)=>(Number(b.views)||0)-(Number(a.views)||0)).slice(0,6);
  const topHtml=top.length?top.map((a,i)=>`<li class="popular-item"><a href="${H(aurl(a))}"><span class="popular-rank">${i+1}</span><span class="popular-copy"><b>${E(a.title)}</b><small>${Number(a.views||0)} قراءة • ${E(a.category)}</small></span></a></li>`).join(''):'<li class="popular-empty">لسه بنجمع القراءات 👀</li>';
  const auth=user?`<span class="hi">مرحبًا ${E(user.name)}</span><a href="/account">حسابي</a><form method="post" action="/logout"><button>خروج</button></form>`:`<a href="/login">دخول</a><a class="reg" href="/register">حساب جديد</a>`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#d3122a">
<title>${E(title)}</title><meta name="description" content="${desc}">${o.noindex?'<meta name="robots" content="noindex,nofollow">':'<meta name="robots" content="index,follow,max-image-preview:large">'}
<link rel="canonical" href="${E(url)}"><link rel="alternate" type="application/rss+xml" title="${SITE} RSS" href="${E(b+'/rss.xml')}"><meta property="og:site_name" content="${SITE}"><meta property="og:locale" content="ar_AR"><meta property="og:type" content="${o.type||'website'}"><meta property="og:title" content="${E(title)}"><meta property="og:description" content="${desc}"><meta property="og:url" content="${E(url)}">${img?`<meta property="og:image" content="${E(img)}"><meta property="og:image:alt" content="${E(o.imageAlt||o.title||SITE)}">`:''}${o.type==='article'&&o.datePublished?`<meta property="article:published_time" content="${E(o.datePublished)}"><meta property="article:modified_time" content="${E(o.dateModified||o.datePublished)}"><meta property="article:section" content="${E(o.section||'أخبار الرياضة')}">`:''}
<meta name="twitter:card" content="${img?'summary_large_image':'summary'}"><meta name="twitter:title" content="${E(title)}"><meta name="twitter:description" content="${desc}">${img?`<meta name="twitter:image" content="${E(img)}">`:''}
<link rel="icon" href="${logo||'/logo.svg'}" type="${logo?'image/png':'image/svg+xml'}"><link rel="apple-touch-icon" href="${logo||'/logo.svg'}"><link rel="stylesheet" href="/style.css">${globalLd.map(ld).join('')}</head><body>
<header><div class="bar">${logo?`<a class="logo logo-image" href="/"><img src="${E(logo)}" alt="${SITE}"></a>`:`<a class="logo" href="/">SPORT<span>SCOPE</span></a>`}<nav aria-label="القائمة الرئيسية">${NAV.map(([h,t])=>`<a href="${h}"${h===path_?' class="on"':''}>${t}</a>`).join('')}</nav>
<form class="sf" action="/search" role="search"><input name="q" placeholder="بحث..." aria-label="بحث" maxlength="60"></form><div class="auth">${auth}</div></div></header>
<div class="ticker"><div>${m}</div></div><main class="${aside?'':'one'}"><section>${main}</section>${aside?`<aside><div class="box popular-box"><div class="section-head"><h2>الأكثر قراءة</h2><span class="live-dot">الآن</span></div><p class="popular-intro">الأخبار اللي عليها إقبال من زوار SportScope.</p><ol>${topHtml}</ol></div><div class="box vibe-box"><b>🔥 خليك في قلب الحدث</b><p>تابع المباريات والأخبار الجديدة أول بأول.</p><a href="/news">شوف آخر الأخبار ←</a></div></aside>`:''}</main>
<footer><nav>${NAV.map(([h,t])=>`<a href="${h}">${t}</a>`).join(' • ')}</nav><p>© ${new Date().getFullYear()} ${SITE} - جميع الحقوق محفوظة</p></footer>
<script>
const fmtC=(ms)=>{ms=Math.max(0,ms);const s=Math.floor(ms/1000),d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60),sec=s%60;return (d?d+' يوم ':'')+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0')};
function stateFor(t){const start=new Date(t).getTime(),now=Date.now();if(!t||!Number.isFinite(start))return 'لم تبدأ';if(now<start)return 'لم تبدأ';if(now<start+7200000)return 'مباشر';return 'انتهت'}
function refreshMatchCountdowns(){document.querySelectorAll('.match-card').forEach(el=>{const t=el.dataset.start||el.querySelector('.match-countdown')?.dataset.start;if(!t)return;const diff=new Date(t).getTime()-Date.now(),state=stateFor(t),c=el.querySelector('.match-countdown'),st=el.querySelector('.match-status');if(c)c.textContent=state==='لم تبدأ'?'متبقي '+fmtC(diff):state==='مباشر'?'مباشر الآن':'انتهت المباراة';if(st)st.textContent=state;});const countdown=document.querySelector('[data-match-countdown]');if(countdown){const t=countdown.dataset.matchCountdown,diff=new Date(t).getTime()-Date.now(),state=stateFor(t);countdown.textContent=state==='لم تبدأ'?fmtC(diff):state==='مباشر'?'مباشر الآن':'انتهت المباراة';const badge=document.querySelector('[data-match-state]');if(badge)badge.textContent=state;}}
refreshMatchCountdowns();setInterval(refreshMatchCountdowns,1000);
</script>
</body></html>`;
}
const html=(req,res,code,s,extra={})=>{const h={'Content-Type':'text/html; charset=utf-8','Vary':'Accept-Encoding',...extra};if(/gzip/.test(req.headers['accept-encoding']||'')){h['Content-Encoding']='gzip';s=zlib.gzipSync(s)}res.writeHead(code,h);res.end(s)};
const authForm=(reg,v={},err='')=>`<h1>${reg?'إنشاء حساب جديد':'تسجيل الدخول'}</h1><form class="af" method="post" action="/${reg?'register':'login'}">${err?`<p class="er" role="alert">${E(err)}</p>`:''}
${reg?`<label>الاسم<input name="name" required minlength="2" maxlength="40" value="${E(v.name)}" autocomplete="name"></label>`:''}
<label>البريد الإلكتروني<input type="email" name="email" required maxlength="120" value="${E(v.email)}" autocomplete="email"></label>
<label>كلمة المرور<input type="password" name="password" required minlength="8" maxlength="100" autocomplete="${reg?'new-password':'current-password'}"></label>
${reg?'<label>تأكيد كلمة المرور<input type="password" name="password2" required minlength="8" maxlength="100" autocomplete="new-password"></label>':''}
<button>${reg?'إنشاء الحساب':'دخول'}</button><p>${reg?'عندك حساب؟ <a href="/login">سجّل دخولك</a>':'<a href="/forgot-password">نسيت كلمة المرور؟</a> · ليس لديك حساب؟ <a href="/register">أنشئ حسابًا</a>'}</p></form>`;
const getUser=req=>{const sid=(req.headers.cookie||'').split(';').map(s=>s.trim().split('=')).find(([k])=>k==='sid')?.[1];const s=usess.get(sid);return s&&s.exp>Date.now()?db.users.find(u=>u.id===s.uid):null};
const login=(req,res,uid)=>{const t=crypto.randomBytes(24).toString('hex');usess.set(t,{uid,exp:Date.now()+2592e6});
  res.writeHead(303,{Location:'/account','Set-Cookie':`sid=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${req.headers['x-forwarded-proto']==='https'?'; Secure':''}`});res.end()};

async function site(req,res,u){
  const p=decodeURIComponent(u.pathname).replace(/\/+$/,'')||'/',m=req.method,user=getUser(req),ip=req.socket.remoteAddress;
  const out=(code,o,main,aside=true)=>html(req,res,code,page(req,{path:p,...o},user,main,aside));
  if(m==='POST'){
    if(p==='/logout'){res.writeHead(303,{Location:'/','Set-Cookie':'sid=; Max-Age=0; Path=/'});res.end();return true}
    if(p==='/forgot-password'){const b=await body(req),email=String(b.email||'').trim().toLowerCase(),u=db.users.find(x=>x.email===email);
      if(!u){return out(200,{title:'استرجاع كلمة المرور',noindex:1},`<h1>استرجاع كلمة المرور</h1><form class="af" method="post" action="/forgot-password"><p>إذا كان البريد مسجّلًا، سيتم إنشاء رابط استرجاع.</p><label>البريد الإلكتروني<input type="email" name="email" required value="${E(email)}"></label><button>إرسال</button></form>`,false),true}
      const tok=crypto.randomBytes(24).toString('hex');u.resetToken=tok;u.resetExp=Date.now()+30*60*1000;save(db);
      const link='/reset-password?token='+encodeURIComponent(tok);
      return out(200,{title:'استرجاع كلمة المرور',noindex:1},`<h1>استرجاع كلمة المرور</h1><div class="box"><p>تم إنشاء رابط تغيير كلمة المرور. افتح الرابط التالي لإكمال العملية:</p><p><a href="${E(link)}" style="color:var(--red);word-break:break-all">${E(link)}</a></p><p class="meta">صلاحية الرابط 30 دقيقة.</p></div>`,false),true}
    if(p==='/reset-password'){const b=await body(req),tok=String(b.token||'').trim(),u=db.users.find(x=>x.resetToken===tok&&x.resetExp>Date.now());
      if(!u)return out(400,{title:'تغيير كلمة المرور',noindex:1},`<h1>تغيير كلمة المرور</h1><p class="er">الرابط غير صالح أو انتهت صلاحيته.</p><p><a href="/forgot-password">طلب رابط جديد</a></p>`,false),true;
      const pass=String(b.password||''),pass2=String(b.password2||'');
      if(pass.length<8||pass!==pass2)return out(400,{title:'تغيير كلمة المرور',noindex:1},`<h1>تغيير كلمة المرور</h1><form class="af" method="post" action="/reset-password"><input type="hidden" name="token" value="${E(tok)}"><label>كلمة المرور الجديدة<input type="password" name="password" minlength="8" required></label><label>تأكيد كلمة المرور<input type="password" name="password2" minlength="8" required></label><p class="er">تأكد أن كلمتي المرور متطابقتان (8 أحرف على الأقل).</p><button>تغيير كلمة المرور</button></form>`,false),true;
      u.salt=crypto.randomBytes(16).toString('hex');u.hash=hash(pass,u.salt);delete u.resetToken;delete u.resetExp;save(db);
      return out(200,{title:'تم تغيير كلمة المرور',noindex:1},`<h1>تم تغيير كلمة المرور</h1><p>تم تغيير كلمة المرور بنجاح. يمكنك الآن <a href="/login" style="color:var(--red)">تسجيل الدخول</a>.</p>`,false),true}
    if(p==='/register'){const b=await body(req),v={name:String(b.name||'').trim(),email:String(b.email||'').trim().toLowerCase()};
      const bad=e=>out(400,{title:'إنشاء حساب',noindex:1},authForm(1,v,e),false);
      if(limited('r'+ip,10,9e5))return bad('محاولات كثيرة، حاول لاحقًا')||true;
      if(v.name.length<2||v.name.length>40)return bad('الاسم يجب أن يكون بين 2 و40 حرفًا'),true;
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email))return bad('البريد الإلكتروني غير صحيح'),true;
      if(String(b.password||'').length<8)return bad('كلمة المرور يجب ألا تقل عن 8 أحرف'),true;
      if(b.password!==b.password2)return bad('كلمتا المرور غير متطابقتين'),true;
      if(db.users.some(x=>x.email===v.email))return bad('هذا البريد مسجّل بالفعل'),true;
      const salt=crypto.randomBytes(16).toString('hex'),us={id:db.nextId++,name:v.name,email:v.email,salt,hash:hash(b.password,salt),date:new Date().toISOString()};
      db.users.push(us);save(db);login(req,res,us.id);return true}
    if(p==='/login'){const b=await body(req),em=String(b.email||'').trim().toLowerCase(),x=db.users.find(y=>y.email===em);
      if(limited('l'+ip,8,9e5)){out(429,{title:'تسجيل الدخول',noindex:1},authForm(0,{email:em},'محاولات كثيرة، حاول بعد 15 دقيقة'),false);return true}
      const ok=x&&hash(String(b.password||''),x.salt)===x.hash;
      if(!ok){out(401,{title:'تسجيل الدخول',noindex:1},authForm(0,{email:em},'البريد أو كلمة المرور غير صحيحة'),false);return true}
      tries.delete('l'+ip);login(req,res,x.id);return true}
    return false}
  if(m!=='GET'&&m!=='HEAD')return false;
  const A=arts(),b=base(req);
  if(p==='/'){const h=A.slice(0,3),mt=db.matches.slice(0,4),popular=[...A].sort((a,b)=>(Number(b.views)||0)-(Number(a.views)||0)).slice(0,4);
    out(200,{title:'',desc:'تابع آخر أخبار كرة القدم والرياضة العربية والعالمية، نتائج المباريات المباشرة وترتيب الدوريات على SportScope.',
      ld:[{'@context':'https://schema.org','@type':'WebSite',name:SITE,url:b+'/',inLanguage:'ar',potentialAction:{'@type':'SearchAction',target:b+'/search?q={q}','query-input':'required name=q'}},{'@context':'https://schema.org','@type':'Organization',name:SITE,url:b+'/'}]},
      `<div class="welcome-strip"><div><span class="pulse"></span><b>SPORTSCOPE LIVE</b><span>أخبارك الرياضية من قلب الحدث</span></div><a href="/matches">المباريات الآن ←</a></div><div class="hero">${h.map((a,i)=>tile(a,i?'':'big')).join('')}</div><div class="home-chips">${['كرة القدم','الدوري المصري','الدوري الإنجليزي','دوري أبطال أوروبا','ميركاتو'].map(c=>`<a href="${H('/category/'+c)}">${E(c)}</a>`).join('')}</div><div class="section-head home-title"><h2>آخر الأخبار</h2><a href="/news">عرض الكل ←</a></div><div class="grid">${A.slice(3,11).map(card).join('')}</div><div class="popular-home"><div class="section-head"><h2>🔥 الناس بتقرأ إيه؟</h2><a href="/news">كل الأخبار ←</a></div><div class="popular-grid">${popular.map((a,i)=>`<a class="popular-card" href="${H(aurl(a))}"><span class="pc-rank">0${i+1}</span><div><em>${E(a.category)}</em><b>${E(a.title)}</b><small>👁 ${Number(a.views||0)} قراءة</small></div></a>`).join('')}</div></div><div class="section-head home-title"><h2>⚽ مباريات اليوم</h2><a href="/matches">كل المباريات ←</a></div>${mt.map(mrow).join('')}`);return true}
  if(p==='/news'||p.startsWith('/category/')){const c=p==='/news'?'':p.slice(10),l=(c?A.filter(a=>a.category===c):A).slice(0,60);
    if(c&&!CATS.includes(c))return false;
    out(200,{title:c?`أخبار ${c}`:'آخر الأخبار الرياضية',desc:`تابع أحدث ${c?'أخبار '+c:'الأخبار الرياضية'} أولاً بأول على ${SITE}.`},
      `<div class="chips">${['الكل',...CATS].map(x=>`<a href="${H(x==='الكل'?'/news':'/category/'+x)}" class="${(x===c||(x==='الكل'&&!c))?'on':''}">${E(x)}</a>`).join('')}</div><h1>${E(c?'أخبار '+c:'كل الأخبار')}</h1><div class="grid">${l.map(card).join('')||'<p>لا توجد أخبار</p>'}</div>`);return true}
  let mm=p.match(/^\/news\/(\d+)(?:-.*)?$/);
  if(mm){const a=db.articles.find(x=>x.id===+mm[1]);if(!a)return false;
    if(p!==aurl(a)){res.writeHead(301,{Location:encodeURI(aurl(a))});res.end();return true}
    countArticleView(req,res,a);const rel=A.filter(x=>x.category===a.category&&x.id!==a.id).slice(0,4),url=b+encodeURI(aurl(a)),image=absImg(req,a.image),modified=a.dateModified||a.date;
    const seoTitle=String(a.seoTitle||a.title).trim().slice(0,70);
    const seoDesc=String(a.seoDescription||a.body.replace(/\s+/g,' ')).trim().slice(0,160);
    const imageAlt=String(a.imageAlt||a.title).trim().slice(0,180);
    out(200,{title:seoTitle,desc:seoDesc,type:'article',image:image,datePublished:a.date,dateModified:modified,section:a.category,imageAlt:imageAlt,
      ld:[{'@context':'https://schema.org','@type':'NewsArticle',headline:a.title.slice(0,110),description:seoDesc,datePublished:a.date,dateModified:modified,mainEntityOfPage:{'@type':'WebPage','@id':url},inLanguage:'ar',isAccessibleForFree:true,articleSection:a.category,wordCount:a.body.trim().split(/\s+/).filter(Boolean).length,author:{'@type':'Organization',name:SITE,url:b+'/about'},publisher:{'@type':'Organization',name:SITE,url:b+'/about'},...(image?{image:[image]}:{})},
        {'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[[SITE,b+'/'],[a.category,b+encodeURI('/category/'+a.category)],[a.title,url]].map((x,i)=>({'@type':'ListItem',position:i+1,name:x[0],item:x[1]}))}]},
      `<article><nav class="bc" aria-label="مسار التنقل"><a href="/">الرئيسية</a> › <a href="${H('/category/'+a.category)}">${E(a.category)}</a></nav><h1>${E(a.title)}</h1><p class="meta"><time datetime="${E(a.date)}">${D(a.date)}</time> • ${E(a.category)}</p>${isImg(a)?`<img class="ai" src="${E(a.image)}" alt="${E(imageAlt)}" loading="eager">`:''}<div class="ab">${a.body.split('\n').filter(Boolean).map(x=>`<p>${E(x)}</p>`).join('')}</div></article>${rel.length?`<h2>أخبار ذات صلة</h2><div class="grid">${rel.map(card).join('')}</div>`:''}`);return true}
  let mx=p.match(/^\/match\/(\d+)$/);
  if(mx){const x=db.matches.find(v=>v.id===+mx[1]);if(!x)return false;const state=matchState(x),start=x.startAt?new Date(x.startAt):null;const initial=state==='لم تبدأ'&&start?fmtCountdown(start.getTime()-Date.now()):state==='مباشر'?'مباشر الآن':'انتهت المباراة';const note=state==='لم تبدأ'?'العد التنازلي حتى صافرة البداية':state==='مباشر'?'المباراة في وقتها المباشر الآن':'انتهى الوقت التلقائي للمباراة';out(200,{title:`${x.home} ضد ${x.away}`,desc:`موعد مباراة ${x.home} و${x.away} في ${x.league}. تابع العد التنازلي وحالة المباراة تلقائيًا.`},`<div class="match-detail-wrap"><a href="/matches" class="back-link">← العودة إلى كل المباريات</a><div class="match-page"><div class="match-page-top"><span class="match-page-league">${E(x.league)}</span><span class="match-state" data-match-state>${E(state)}</span></div><div class="match-teams"><div class="team-block"><div class="team-logo">${E(String(x.home||'?').trim().slice(0,2))}</div><h1>${E(x.home)}</h1><span>الفريق الأول</span></div><div class="match-vs"><small>VS</small></div><div class="team-block"><div class="team-logo">${E(String(x.away||'?').trim().slice(0,2))}</div><h1>${E(x.away)}</h1><span>الفريق الثاني</span></div></div><div class="match-info-row"><div><small>موعد المباراة</small><strong>${E(matchLabel(x))}</strong></div><div><small>الحالة</small><strong data-match-state>${E(state)}</strong></div></div><div class="countdown-panel"><small>${E(note)}</small><div class="match-big-countdown" data-match-countdown="${E(x.startAt||'')}">${initial}</div><p class="match-note">${state==='لم تبدأ'?'سيبدأ العداد تلقائيًا عند فتح الصفحة ويتحدث كل ثانية.':state==='مباشر'?'يتم عرض المباراة كمباشرة تلقائيًا من وقت البداية ولمدة ساعتين.':'تم تحويل الحالة إلى انتهت تلقائيًا بعد مرور ساعتين على البداية.'}</p></div></div></div>`);return true}
  if(p==='/matches'){const selectedLeague=u.searchParams.get('league')||'';const safeLeague=LEAGUES.includes(selectedLeague)?selectedLeague:'';const matches=safeLeague?db.matches.filter(x=>x.league===safeLeague):db.matches;const heading=safeLeague?`مباريات ${E(safeLeague)}`:'المباريات والنتائج';const desc=safeLeague?`مباريات ${safeLeague} ومواعيدها وحالتها تلقائيًا.`:'جدول مباريات اليوم ونتائج المباريات المباشرة في الدوريات العربية والعالمية.';out(200,{title:heading.replace(/<[^>]+>/g,''),desc},`<div class="matches-hero matches-hero-clean"><div><span>⚡ SPORTScope MATCH CENTER</span><h1>${heading}</h1><p>${safeLeague?'دي كل المباريات المضافة للبطولة دي.':'اختار بطولة من صفحة البطولات لمشاهدة مبارياتها فقط.'}</p></div><a href="/leagues">كل البطولات ←</a></div>${safeLeague?`<div class="matches-filter"><span>البطولة المختارة</span><b>${E(safeLeague)}</b><a href="/matches">عرض كل المباريات</a></div>`:''}<div class="matches-grid matches-grid-clean">${matches.map(mrow).join('')||`<div class="no-matches"><b>لا توجد مباريات لهذه البطولة حاليًا</b><span>ارجع للبطولات واختار بطولة أخرى.</span></div>`}</div>`,false);return true}
  if(p==='/leagues'){out(200,{title:'البطولات والدوريات',desc:'ترتيب الدوريات وأخبار البطولات العربية والعالمية.'},`<div class="leagues-hero"><div class="leagues-kicker">🏆 عالم البطولات</div><h1>البطولات والدوريات</h1><p>اختار البطولة من الخانات بالأسفل لمشاهدة أخبارها وترتيبها ومبارياتها.</p></div><div class="league-buttons league-buttons-simple" id="leagueButtons">${LEAGUES.map(l=>`<a class="league-button-simple ${leagueClass(l)}" href="/matches?league=${encodeURIComponent(l)}"><b>${E(l)}</b><span>مباريات البطولة ←</span></a>`).join('')}</div>`);return true}
  if(p.startsWith('/league/')){const n=p.slice(8);if(!LEAGUES.includes(n))return false;const s=db.standings.filter(x=>x.league===n).sort((a,b)=>b.pts-a.pts);
    out(200,{title:`ترتيب ${n} وأخبارها`,desc:`جدول ترتيب ${n} وآخر أخبار البطولة ونتائج المباريات.`},
      `<h1>${E(n)}</h1><table><caption class="sr">ترتيب ${E(n)}</caption><tr><th>#</th><th>الفريق</th><th>لعب</th><th>فوز</th><th>تعادل</th><th>خسارة</th><th>نقاط</th></tr>${s.map((x,i)=>`<tr><td>${i+1}</td><td>${E(x.team)}</td><td>${E(x.p)}</td><td>${E(x.w)}</td><td>${E(x.d)}</td><td>${E(x.l)}</td><td><b>${E(x.pts)}</b></td></tr>`).join('')||'<tr><td colspan="7">لا يوجد ترتيب</td></tr>'}</table><h2 style="margin-top:24px">أخبار ${E(n)}</h2><div class="grid">${A.filter(a=>a.category===n).map(card).join('')||'<p>لا توجد أخبار</p>'}</div>`);return true}
  if(p==='/videos'){out(200,{title:'فيديو - أهداف وملخصات',desc:'أحدث الفيديوهات الرياضية: أهداف وملخصات وتقارير.'},`<h1>فيديو</h1><div class="grid">${db.videos.map(x=>`<div class="card">${embed(x.url)?`<iframe src="${E(embed(x.url))}" title="${E(x.title)}" loading="lazy" allowfullscreen></iframe>`:''}<div class="t">${E(x.title)}</div></div>`).join('')||'<p>لا توجد فيديوهات بعد</p>'}</div>`);return true}
  if(p==='/about'){const a=db.about?.[0]||{title:'من نحن',body:'SportScope موقع رياضي يقدم آخر الأخبار والنتائج وترتيب البطولات.',email:'info@example.com'};out(200,{title:a.title||'من نحن',desc:`تعرّف على ${SITE}، موقعك لأخبار الرياضة ونتائج المباريات.`},`<div class="about-hero"><span>👋 أهلاً بك في SportScope</span><h1>${E(a.title||'من نحن')}</h1><p>${E(a.body||'')}</p></div><div class="about-card"><b>📩 تواصل معنا</b><a href="mailto:${E(a.email||'info@example.com')}">${E(a.email||'info@example.com')}</a></div>`);return true}
  if(p==='/search'){const q=(u.searchParams.get('q')||'').trim().slice(0,60),l=q?A.filter(a=>a.title.includes(q)):[];
    out(200,{title:'نتائج البحث',noindex:1},`<h1>نتائج البحث${q?': '+E(q):''}</h1><div class="grid">${l.map(card).join('')||'<p>لا توجد نتائج</p>'}</div>`);return true}
  if(p==='/forgot-password'){out(200,{title:'استرجاع كلمة المرور',noindex:1},`<h1>استرجاع كلمة المرور</h1><form class="af" method="post" action="/forgot-password"><p>اكتب بريدك الإلكتروني لإنشاء رابط تغيير كلمة المرور.</p><label>البريد الإلكتروني<input type="email" name="email" required maxlength="120" autocomplete="email"></label><button>إرسال</button><p><a href="/login">العودة لتسجيل الدخول</a></p></form>`,false);return true}
  if(p==='/reset-password'){const tok=u.searchParams.get('token')||'',ok=db.users.some(x=>x.resetToken===tok&&x.resetExp>Date.now());
    out(ok?200:400,{title:'تغيير كلمة المرور',noindex:1},ok?`<h1>تغيير كلمة المرور</h1><form class="af" method="post" action="/reset-password"><input type="hidden" name="token" value="${E(tok)}"><label>كلمة المرور الجديدة<input type="password" name="password" minlength="8" maxlength="100" required autocomplete="new-password"></label><label>تأكيد كلمة المرور<input type="password" name="password2" minlength="8" maxlength="100" required autocomplete="new-password"></label><button>تغيير كلمة المرور</button></form>`:`<h1>تغيير كلمة المرور</h1><p class="er">الرابط غير صالح أو انتهت صلاحيته.</p><p><a href="/forgot-password">طلب رابط جديد</a></p>`,false);return true}
  if(p==='/login'||p==='/register'){if(user){res.writeHead(303,{Location:'/account'});res.end();return true}out(200,{title:p==='/login'?'تسجيل الدخول':'إنشاء حساب',noindex:1},authForm(p==='/register'),false);return true}
  if(p==='/account'){if(!user){res.writeHead(303,{Location:'/login'});res.end();return true}
    out(200,{title:'حسابي',noindex:1},`<h1>حسابي</h1><div class="box"><p>الاسم: <b>${E(user.name)}</b></p><p>البريد: <b>${E(user.email)}</b></p><p>تاريخ التسجيل: ${D(user.date)}</p></div>`,false);return true}
  if(p==='/robots.txt'){res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'public,max-age=3600'});res.end(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /account\nDisallow: /login\nDisallow: /register\nDisallow: /forgot-password\nDisallow: /reset-password\nDisallow: /search\n\nUser-agent: Googlebot-News\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /account\nDisallow: /login\nDisallow: /register\nDisallow: /forgot-password\nDisallow: /reset-password\nDisallow: /search\n\nSitemap: ${b}/sitemap.xml\nSitemap: ${b}/news-sitemap.xml\n`);return true}
  if(p==='/sitemap.xml'){const x=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'),us=[['/',''],['/news',''],['/matches',''],['/leagues',''],['/videos',''],['/about',''],...CATS.map(c=>['/category/'+c,'']),...LEAGUES.map(l=>['/league/'+l,'']),...A.map(a=>[aurl(a),a.dateModified||a.date])];res.writeHead(200,{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public,max-age=1800'});res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${us.map(([l,d])=>{const a=A.find(q=>aurl(q)===l),im=a&&isImg(a)?absImg(req,a.image):'';return `<url><loc>${x(b+encodeURI(l))}</loc>${d?`<lastmod>${new Date(d).toISOString()}</lastmod>`:''}${im?`<image:image><image:loc>${x(im)}</image:loc><image:title>${x(a.title)}</image:title></image:image>`:''}</url>`}).join('')}</urlset>`);return true}
  if(p==='/news-sitemap.xml'){const cutoff=Date.now()-48*60*60*1000,news=A.filter(a=>new Date(a.date).getTime()>=cutoff).slice(0,1000),x=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');res.writeHead(200,{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public,max-age=900'});res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${news.map(a=>`<url><loc>${x(b+encodeURI(aurl(a)))}</loc><news:news><news:publication><news:name>${x(SITE)}</news:name><news:language>ar</news:language></news:publication><news:publication_date>${new Date(a.date).toISOString()}</news:publication_date><news:title>${x(a.title)}</news:title></news:news></url>`).join('')}</urlset>`);return true}
  if(p==='/rss.xml'){const x=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'),items=A.slice(0,30).map(a=>`<item><title>${x(a.title)}</title><link>${x(b+encodeURI(aurl(a)))}</link><guid isPermaLink="true">${x(b+encodeURI(aurl(a)))}</guid><pubDate>${new Date(a.date).toUTCString()}</pubDate><description>${x(a.body.replace(/\s+/g,' ').slice(0,500))}</description><category>${x(a.category)}</category></item>`).join('');res.writeHead(200,{'Content-Type':'application/rss+xml; charset=utf-8','Cache-Control':'public,max-age=900'});res.end(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${x(SITE)}</title><link>${x(b+'/')}</link><description>${x(SITE+' - أخبار الرياضة ونتائج المباريات')}</description><language>ar</language><lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${items}</channel></rss>`);return true}
  return false;
}

http.createServer(async(req,res)=>{try{
  const u=new URL(req.url,'http://x'),p=u.pathname,m=req.method;
  if(req.headers.origin==='null'){res.setHeader('Access-Control-Allow-Origin','null');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE')}
  if(m==='OPTIONS'){res.writeHead(204);return res.end()}
  if(p.startsWith('/api/')){
    const id=+p.split('/')[3];
    if(p==='/api/login'&&m==='POST'){
      const ip=req.socket.remoteAddress,t=tries.get('a'+ip)||{n:0,until:0};
      if(t.until>Date.now())return send(res,429,{error:'محاولات كثيرة، حاول لاحقًا'});
      const b=await body(req),a=db.admin;
      const ok=b.user===a.user&&hash(String(b.pass||''),a.salt)===a.hash;
      if(!ok){t.n++;if(t.n>=5){t.n=0;t.until=Date.now()+9e5}tries.set('a'+ip,t);return send(res,401,{error:'بيانات الدخول غير صحيحة'})}
      tries.delete('a'+ip);const tok=crypto.randomBytes(24).toString('hex');sessions.set(tok,Date.now()+288e5);return send(res,200,{token:tok});
    }
    const col=p.split('/')[2],F=SCHEMA[col];
    if(col==='about'||col==='siteSettings'){if(!authed(req))return send(res,401,{error:'غير مصرح'});if(m==='GET')return send(res,200,db[col]||[]);if(m==='PUT'||m==='POST'){const b=(req.headers['content-type']||'').startsWith('multipart/form-data')?await parseMultipart(req):await body(req);db[col]=db[col]||[{id:1}];Object.assign(db[col][0],clean(b,F));save(db);return send(res,200,db[col][0])}return send(res,405,{error:'غير مسموح'})}
    if(col==='users'){
      if(!authed(req))return send(res,401,{error:'غير مصرح'});
      if(m!=='GET')return send(res,405,{error:'غير مسموح'});
      return send(res,200,db.users.map(x=>({id:x.id,name:x.name,email:x.email,date:x.date})));
    }
    if(!F)return send(res,404,{});
    if(m==='GET'&&!id){let l=[...db[col]];
      if(col==='articles'){const c=u.searchParams.get('cat'),q=u.searchParams.get('q');l.sort((a,b)=>b.date.localeCompare(a.date));if(c)l=l.filter(a=>a.category===c);if(q)l=l.filter(a=>a.title.includes(q))}
      return send(res,200,l)}
    if(m==='GET'){const a=db[col].find(x=>x.id===id);return a?send(res,200,a):send(res,404,{})}
    if(!authed(req))return send(res,401,{error:'غير مصرح'});
    if(m==='POST'){const b=(req.headers['content-type']||'').startsWith('multipart/form-data')?await parseMultipart(req):await body(req);const now=new Date().toISOString();const x={id:db.nextId++,...clean(b,F),date:now,dateModified:now,views:0};if(col==='matches'&&x.startAt){x.time=new Date(x.startAt).toLocaleString('ar-EG',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});x.status='لم تبدأ'}db[col].push(x);save(db);return send(res,201,x)}
    if(m==='PUT'){const x=db[col].find(y=>y.id===id);if(!x)return send(res,404,{});const b=(req.headers['content-type']||'').startsWith('multipart/form-data')?await parseMultipart(req):await body(req);Object.assign(x,clean(b,F));if(col==='matches'&&x.startAt){x.time=new Date(x.startAt).toLocaleString('ar-EG',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});x.status='لم تبدأ'}if(col==='articles')x.dateModified=new Date().toISOString();save(db);return send(res,200,x)}
    if(m==='DELETE'){db[col]=db[col].filter(x=>x.id!==id);save(db);return send(res,200,{})}
    return send(res,404,{});
  }
  if(await site(req,res,u))return;
  const f=path.join(PUB,p==='/admin'?'admin.html':p);
  if(m==='GET'&&p!=='/'&&f.startsWith(PUB)&&fs.existsSync(f)&&fs.statSync(f).isFile()){
    res.writeHead(200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream','Cache-Control':p==='/admin'?'no-store':'public,max-age=3600','X-Robots-Tag':p==='/admin'?'noindex':'all'});return fs.createReadStream(f).pipe(res)}
  const user=getUser(req);html(req,res,404,page(req,{path:'/404',title:'الصفحة غير موجودة',noindex:1},user,'<h1>404</h1><p>الصفحة المطلوبة غير موجودة. <a href="/">العودة للرئيسية</a></p>',false));
}catch(e){console.error(e);if(!res.headersSent){res.writeHead(500);res.end('Server error')}}}).listen(PORT,()=>console.log(`${SITE}: http://localhost:${PORT}  |  admin: /admin`));
