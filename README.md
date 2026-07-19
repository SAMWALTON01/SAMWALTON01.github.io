# מערכת קמפייני סמס + פאנל ווב — מסמך מסירה למפתח

גרסה: יולי 2026 • סטטוס: עובד, נבדק end-to-end, מוכן ל-production

מסמך זה מלווה את מסירת המערכת. הוא מכסה: מה נבנה, איפה כל דבר גר, איך משנים דברים נפוצים, ואיך מעבירים בעלות.

## 1. מה המערכת עושה

שולחים קמפיין סמס (Inforu) עם **לינק אישי לכל נמען** → הנמען נכנס לפאנל ווב בסגנון וואטסאפ (12 שאלות, עברית RTL) → הליד נשמר ב-DB עם סיכום אוטומטי → דשבורד ניהול (שליחה, סטטיסטיקות, לידים, ייצוא).

גם מי שלחץ ולא סיים — נרשם עם הטלפון שלו ("ליד חם").

**שמירת התקדמות:** מי שנכנס לפאנל ועושה רענון / סוגר וחוזר (עד 24 שעות) — ממשיך בדיוק מאיפה שעצר, עם כל היסטוריית הצ'אט (נשמר ב-localStorage). בנוסף כל תשובה נשמרת ב-DB כליד **חלקי** (`is_completed=false`, upsert אחד ל-24 שעות — לא נוצרות שורות כפולות), וברגע הסיום אותה שורה הופכת ל-`is_completed=true`. בדשבורד רואים תגית "חלקי" ליד לידים כאלה.

## 2. ארכיטקטורה

```
┌─────────────────┐   לינק אישי    ┌──────────────────────────┐
│  Inforu (סמס)   │ ─────────────► │  GitHub Pages (סטטי)     │
└─────────────────┘  ?p=&n=&c=     │  index.html  = פאנל      │
                                   │  admin.html  = דשבורד    │
                                   └─────────┬────────────────┘
                                             │ RPC בלבד (anon key)
                                             ▼
              ┌───────────────────────────────────────────────────────┐
              │  DB מרכזי: Supabase self-hosted על שרת הלקוח          │
              │  db.nahmanbot.com (Kong → Postgres, 13K+ לידים)       │
              │  הפאנל כותב לידים ישירות לטבלת leads המרכזית          │
              └───────────────────────────────────────────────────────┘
                                             ▲
              ┌──────────────────────────────┴───────────────────────┐
              │  Edge Functions (בשרת + בענן כגיבוי, אותו קוד):      │
              │   send-sms-campaign ──► Inforu API                   │
              │   admin-api ◄── דשבורד (x-admin-token)               │
              │  שתיהן מדברות אל ה-DB המרכזי ב-service key שלו       │
              └──────────────────────────────────────────────────────┘
```

ה-DB המרכזי הוא **אותו DB שהבוט וה-CRM של הלקוח עובדים איתו** — ליד מהפאנל נולד
ישירות בטבלת `leads` שהם רואים. פונקציות ה-edge מותקנות בשני מקומות במקביל
(אותו קוד, אותם קבועים): ב-edge-runtime של השרת (`/root/supabase/volumes/functions/`,
הותקן ואומת 19.7) ובפרויקט הענן הישן כגיבוי. אין בהן דאטה — רק קוד.

## 3. רכיבי המערכת

| נתיב | מה זה |
|---|---|
| `index.html` | הפאנל ללקוחות. הפלואו (12 שאלות) **מוטמע בקוד** באובייקט `FLOW` |
| `admin.html` | דשבורד ניהול: שליחת קמפיין / סטטיסטיקות / לידים + ייצוא CSV / **קבוצות אנשי קשר** |
| `supabase/functions/send-sms-campaign/` | שליחה דרך Inforu (שרת-צד, מוגן טוקן). `SHORTEN_URL=true` מפעיל את מקצר הקישורים של Inforu |
| `supabase/functions/admin-api/` | API קריאה/כתיבה לדשבורד (קמפיינים/לידים/ייצוא/**קבוצות**) |
| `supabase/functions/inforu-probe/` | כלי בדיקה: קישוריות + Sender IDs מורשים |
| `supabase/migrations/` | כל ה-DDL: RPCs (`submit_web_lead`, `log_web_click`, `calc_summary_web`) + טריגרים + טבלת קבוצות |
| `tools/send.js` | סקריפט CLI חלופי לשליחה (לא דרך הדשבורד) |

## 4. גישות וסודות

| מה | ערך | היכן מוגדר |
|---|---|---|
| DB מרכזי (self-hosted) | `https://db.nahmanbot.com` | בכל הרכיבים |
| anon key של ה-DB המרכזי | בראש `index.html` (`SUPABASE_ANON`) — מקור: `/root/supabase/.env` בשרת | `index.html` |
| service key של ה-DB המרכזי | `SUPA_KEY` בשתי הפונקציות — מקור: `/root/supabase/.env` בשרת | `send-sms-campaign`, `admin-api` |
| Supabase Cloud (מראה מיותרת של הפונקציות — לגיבוי בלבד) | `dgmygsvwemgtnvmdnwnz` | — |
| סיסמת דשבורד / admin token | `nahman-campaign-2026-x7q` | `ADMIN_TOKEN` בכל 3 הפונקציות |
| Inforu | user: `Shimon123` / token: בקוד הפונקציה | `send-sms-campaign/index.ts` |
| Sender ID | `nahman` (אומת מול ה-API) | פרמטר `sender` / `DEFAULT_SENDER` |

> ⚠️ **לפני production — מומלץ לשנות** את `ADMIN_TOKEN` (בכל הפונקציות) ולסובב את
> מפתח ה-service של Supabase (הוא נחשף בריפו הישן WhatsAppCrmClean/rebuild-flow.js).
> סיבוב: Supabase Dashboard → Settings → API → Reset service key.

## 5. שינויים נפוצים

**נוסח הודעת ברירת מחדל:** `DEFAULT_MESSAGE` ב-`send-sms-campaign/index.ts`
(בדשבורד עצמו עורכים חופשי לכל קמפיין).

**שאלות הפאנל:** עורכים את `FLOW` ב-`index.html`. שדות נשמרים בפי `field` —
השמות חייבים להתאים לעמודות בטבלת `leads` (רשימה מלאה ב-`submit_web_lead`).

**כתובת הפאנל בלינקים:** `FUNNEL_URL` ב-`send-sms-campaign/index.ts`.

**שם שולח:** שדה בדשבורד / `DEFAULT_SENDER` בפונקציה.

**קבוצות אנשי קשר:** טבלת `contacts` (מיגרציה `003_contacts_groups.sql`), RLS נעול —
הגישה רק דרך admin-api (`save_contacts` / `groups` / `group_contacts` / `delete_group` / `delete_contact`).
ייחודיות על `(phone, group_name)` — שמירה חוזרת לאותה קבוצה **מעדכנת** ולא מכפילה.
בדשבורד: טאב 📇 לניהול, ובטאב השליחה — "טען מקבוצה שמורה" שממלא את רשימת הנמענים.

**קיצור לינקים (חשוב לעלות!):** הודעה בעברית = UCS-2 = **70 תווים לסגמנט**.
הלינק האישי הארוך (~110 תווים) לבדו שורף כמעט 2 סגמנטים. לכן `SHORTEN_URL=true`
ב-`send-sms-campaign/index.ts` — מופעל `ShortenUrlEnable` של Inforu, שמחליף כל URL
בהודעה בלינק קצר (~20 תווים) לפני השליחה. לכבות רק אם רוצים לינק גלוי.

**מעבר ל-DB מרכזי (בוצע 19.7):** מיגרציה `004_central_integration.sql` הורצה על
ה-Postgres בשרת (גיבוי סכמה: `/root/backups/pre-integration-2026-07-19.sql`).
היא מוסיפה: `sms_clicks`, `sms_campaigns`, `contacts` + ויו `contact_group_counts`
+ ה-RPCs (`log_web_click`, `submit_web_lead`, `calc_summary_web`) + 2 טריגרים.
הכל אדיטיבי — לא נגענו בטבלאות/דאטה/קוד של הבוט.

> ⚠️ **פעולה נדרשת מהמתכנת של הלקוח (לא דחוף):** להסיר את ה-Custom Domain
> `db.nahmanbot.com` מהפרויקט הישן ב-Supabase Cloud (Settings → Custom Domains).
> כל עוד הוא מוגדר שם, חלק מצומדי ה-edge של Supabase עשויים לנתב אליו בקשות
> ל-hostname הזה. מאז 19.7 הפונקציות מותקנות גם בשרת עצמו (אומת בלוגים של
> ה-edge-runtime המקומי), ולכן ההסרה בטוחה לחלוטין — שני הצדדים מחזירים אותן
> תשובות מאותו DB. אימתנו ששום רכיב במערכת הראשית (בוט/דשבורד) לא מפנה
> לפרויקט הענן.

## 6. פריסה (Deployment)

- **דפים סטטיים:** כל push ל-`main` → GitHub Pages מתעדכן אוטומטית (~דקה).
- **Edge Functions בשרת:** מעתיקים את `index.ts` ל-`/root/supabase/volumes/functions/<name>/`
  ו-`docker restart supabase-edge-functions`.
- **Edge Functions בענן — גיבוי** (אחרי `npm i -g supabase` + `supabase login`):
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

## 8. העברת בעלות (חשוב!)

היום הכל יושב תחת חשבונות של המפתח הקודם/הנוכחי. להעברה נקייה:

1. **GitHub:** Repository → Settings → Transfer ownership → לחשבון הלקוח
   (או Fork לחשבון שלו + עדכון `FUNNEL_URL` אם שם המשתמש משתנה — ה-URL של Pages תלוי בו!).
2. **Supabase:** Organization → Invite (כ-owner) → הלקוח מסיר את המפתח.
3. **Inforu:** החשבון כבר של הלקוח.
4. **אחרי ההעברה:** לסובב סודות (סעיף 4) ולעדכן טוקנים.

## 9. נתוני בדיקה

כל נתוני הבדיקה נוקו. אם יצטברו שוב:

```sql
delete from sms_clicks where campaign_name like '%test%' or campaign_name like '%בדיקה%';
delete from leads where source = 'web_funnel' and phone in ('0501234567');
```

## 10. בדיקות שבוצעו לפני המסירה ✅

- שליחת 2 סמסים אמיתיים דרך Inforu — התקבלו, Sender `nahman` תקין
- לחיצה → רישום מייד (טלפון+קמפיין+user-agent) כולל זיהוי בוטים (Google-Read-Aloud)
- מילוי מלא של 12 השאלות → ליד עם כל השדות, `summary` אוטומטי, `hechzer_mas`, דה-דופ 24 שעות
- דשבורד: התחברות, סטטיסטיקות, לידים, ייצוא
- קבוצות: שמירה (כולל דה-דופ ונרמול טלפונים), עדכון קבוצה קיימת, צפייה, מחיקת קבוצה/איש קשר, טעינה לטאב שליחה
- רענון באמצע הפאנל: היסטוריה מלאה + המשך מאותה שאלה; ליד חלקי ב-DB תוך שניות; השלמה אחרי רענון מעדכנת את אותה שורה (is_completed=true, summary + hechzer_mas תקינים, בלי כפילויות); רענון אחרי סיום מציג את הצ'אט המושלם
- הרשאות: ה-anon key **לא** יכול לקרוא/לכתוב אף טבלה — רק 2 ה-RPCs המסוננים
- אינטגרציית DB מרכזי: לחיצה + ליד חלקי מהפאנל נרשמו ישירות ב-Postgres בשרת (אומת ב-psql), CORS דרך Kong תקין, מיגרציית 004 הורצה בטרנזקציה אחת עם COMMIT נקי
- פונקציות מקומיות בשרת (19.7): `admin-api` עונה `groups` תקין + 401 על טוקן שגוי, `send-sms-campaign` OPTIONS 204 — אומת ששרת ה-edge-runtime המקומי בלוגים; שום רכיב במערכת הראשית (בוט/דשבורד) לא מפנה לפרויקט הענן הישן (אומת ב-grep מלא)
