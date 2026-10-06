تشغيل الموقع (مطلوب Node.js 18 أو أحدث - https://nodejs.org):
  Windows : اضغط مرتين على start.bat
  Mac/Linux: ./start.sh   أو   node server.js
ثم افتح http://localhost:3000   | لوحة التحكم: http://localhost:3000/admin
لتغيير بيانات الأدمن: احذف data.json ثم شغّل:
  ADMIN_USER=اسم ADMIN_PASS=كلمة node server.js
الخطوة الأخيرة قبل النشر: ضعه خلف HTTPS (Nginx/Cloudflare) وشغّله بـ pm2.
الصفحات: / /news /matches /leagues /videos /about /login /register /account /sitemap.xml /robots.txt
لتفعيل SEO بشكل صحيح بعد النشر: شغّل بالمتغير SITE_URL=https://your-domain.com

SEO / Google:
- Set SITE_URL to the real HTTPS domain in production, e.g. SITE_URL=https://example.com
- Sitemap: /sitemap.xml
- Google News sitemap: /news-sitemap.xml
- RSS feed: /rss.xml
- After deployment, add the domain to Google Search Console and submit /sitemap.xml.
- Use URL Inspection on the homepage and a real news article, then request indexing if needed.
- Google News eligibility is not guaranteed by markup alone; publish original, useful news content with clear dates, authorship, and crawlable article pages.
