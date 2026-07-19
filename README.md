# מערכת קמפייני סמס + פאנל ווב — מסמך מסירה למפתח

**גרסה:** 1.0 | **תאריך מסירה:** 2026-07-19

---

## 1. מה המערכת עושה

שליחת קמפיין סמסים מותאם אישית (Inforu) → כל נמען מקבל **לינק אישי** →
לחיצה נרשמת מייד (טלפון + קמפיין) → פאנל ווב (12 שאלות, מראה וואטסאפ) →
הליד נשמר ב-DB עם סיכום אוטומטי → דשבורד ניהול (שליחה, סטטיסטיקות, לידים, ייצוא).

**אפס שרתים.** הכל רץ על: GitHub Pages (סטטי, חינם) + Supabase (DB + Edge Functions, Free tier).

## 2. ארכיטקטורה

```
סמס (Inforu)
   │ לינק אישי: https://<domain>/?p=PHONE&n=NAME&c=CAMPAIGN
   ▼
┌─────────────────────┐     RPC (anon key)      ┌──────────────────────────┐
│  index.html (פאנל)  │ ──────────────────────► │  Supabase Postgres       │
│  GitHub Pages       │  log_web_click          │  leads, sms_clicks,      │
│                     │  submit_web_lead        │  sms_campaigns           │
└─────────────────────┘                         └──────────────────────────┘
                                                          ▲
┌─────────────────────┐     Edge Functions      ┌────────┴─────────┐
│  admin.html         │ ──────────────────────► │ send-sms-campaign │──► Inforu API
│  (דשבורד ניהול)     │  x-admin-token auth     │ admin-api         │
└─────────────────────┘                         └───────────────────┘
```

## 3. רכיבי המערכת

| נתיב | מה זה |
|---|---|
| `index.html` | הפאנל ללקוחות. הפלואו (12 שאלות) **מוטמע בקוד** באובייקט `FLOW` |
| `admin.html` | דשבורד ניהול: שליחת קמפיין / סטטיסטיקות / לידים + ייצוא CSV |
| `supabase/functions/send-sms-campaign/` | שליחה דרך Inforu (שרת-צד, מוגן טוקן) |
| `supabase/functions/admin-api/` | API קריאה לדשבורד (קמפיינים/לידים/ייצוא) |
| `supabase/functions/inforu-probe/` | כלי בדיקה: קישוריות + Sender IDs מורשים |
| `supabase/migrations/` | כל ה-DDL: RPCs (`submit_web_lead`, `log_web_click`, `calc_summary_web`) + טריגרים |
| `tools/send.js` | סקריפט CLI חלופי לשליחה (לא דרך הדשבורד) |

## 4. גישות וסודות

| מה | ערך | היכן מוגדר |
|---|---|---|
| Supabase project | `dgmygsvwemgtnvmdnwnz` | — |
| anon key (ציבורי, מוגבל ל-2 RPCs) | בראש `index.html` (`SUPABASE_ANON`) | `index.html` |
| סיסמת דשבורד / admin token | `nahman-campaign-2026-x7q` | `ADMIN_TOKEN` בכל 3 הפונקציות |
| Inforu | user: `Shimon123` / token: בקוד הפונקציה | `send-sms-campaign/index.ts` |
| Sender ID | `nahman` (אומת מול ה-API) | פרמטר `sender` / `DEFAULT_SENDER` |

> ⚠️ **לפני production — מומלץ לשנות** את `ADMIN_TOKEN` (בכל הפונקציות) ולסובב את
> מפתח ה-service של Supabase (הוא נחשף בריפו הישן WhatsAppCrmClean/rebuild-flow.js).
> סיבוב: Supabase Dashboard → Settings → API → Reset service key.

## 5. שינויים נפוצים

**נוסח הודעת ברירת מחדל:** `DEFAULT_MESSAGE` ב-`send-sms-campaign/index.ts`
(בדשבורד עצמו עורכים חופשי לכל קמפיין).

**שאלות הפאנל:** עורכים את `FLOW` ב-`index.html`. שדות נשמרים לפי `field` —
השמות חייבים להתאים לעמודות בטבלת `leads` (רשימה מלאה ב-`submit_web_lead`).

**כתובת הפאנל בלינקים:** `FUNNEL_URL` ב-`send-sms-campaign/index.ts`.

**שם שולח:** שדה בדשבורד / `DEFAULT_SENDER` בפונקציה.

## 6. פריסה (Deployment)

- **דפים סטטיים:** כל push ל-`main` → GitHub Pages מתעדכן אוטומטית (~דקה).
- **Edge Functions** (אחרי `npm i -g supabase` + `supabase login`):
  ```bash
  supabase functions deploy send-sms-campaign --project-ref dgmygsvwemgtnvmdnwnz
  supabase functions deploy admin-api        --project-ref dgmygsvwemgtnvmdnwnz
  ```
- **מיגרציות DB:** להריץ את הקבצים ב-`supabase/migrations/` לפי הסדר
  (SQL Editor בדשבורד Supabase או `supabase db push`).

## 7. הוספת התראות מייל על ליד חדש (בקשת הלקוח)

הנקודה המוכנה: טבלת `leads`, שורות חדשות עם `source = 'web_funnel'`.
שתי דרכים מומלצות:
1. **Supabase Database Webhook** על INSERT ל-`leads` → Edge Function חדשה ששולחת מייל (Resend/SendGrid).
2. **קריאה מתוזמנת** (pg_cron / GitHub Actions) ללידים אחרונים → מייל תקופתי.

לשכבת העברת הדואר קיים כבר Resend מוכן בקוד המערכת הישנה (`WhatsAppCrmClean/src/admin-alerts.js`).

## 8. העברת בעלות (חשוב!)

היום הריפו וה-Supabase רשומים על חשבון המפתח המוסר. להשלמת המסירה:
1. **GitHub:** Settings → Transfer repository → לחשבון הלקוח.
   שים לב: כתובת ה-Pages (`<user>.github.io`) תשתנה בהתאם — או לחבר דומיין מותאם
   (מומלץ: `Settings → Pages → Custom domain`) ואז אין תלות בשם החשבון.
2. **Supabase:** Dashboard → Organization → Invite → מייל הלקוח כ-owner.
3. **Inforu:** החשבון (`Shimon123`) כבר של הלקוח ✅

## 9. נתוני בדיקה

ב-DB קיימות שורות מבדיקות (קמפייני `test_*`, `rehearsal_*`). לניקוי לפני production:
```sql
delete from sms_clicks    where campaign_name like 'test%' or campaign_name like 'rehearsal%' or campaign_name like 'e2e%';
delete from sms_campaigns where campaign_name like 'test%' or campaign_name like 'rehearsal%' or campaign_name like 'e2e%';
delete from leads         where name in ('test','בדיקה','Test User','גריק קלגד') and source = 'web_funnel';
```

## 10. בדיקות שבוצעו לפני המסירה ✅

- שליחת 2 סמסים אמיתיים דרך Inforu — התקבלו, Sender `nahman` תקין
- לחיצה → רישום מייד (טלפון+קמפיין+user-agent) כולל זיהוי בוטים (Google-Read-Aloud)
- מילוי מלא של 12 השאלות → ליד עם כל השדות, `summary` אוטומטי, `hechzer_mas`, דה-דופ 24 שעות
- דשבורד: התחברות, סטטיסטיקות, לידים, ייצוא
- הרשאות: ה-anon key **לא** יכול לקרוא/לכתוב אף טבלה — רק 2 ה-RPCs המסוננים
