# NahmanBot — מערכת SMS + פאנל ווב

מערכת לקמפייני SMS עם פאנל ווב (serverless) שמסמן לידים ומזין אותם ישירות ל-DB המרכזי של הלקוח.

## 1. מה יש כאן

- **פאנל ווב** (`index.html`) — 12 שאלות תנאי, נגיש ממובייל, כותב לידים ישירות לטבלת `leads` ב-DB המרכזי דרך RPC. **שומר התקדמות מקומית (localStorage, 24 שעות) + שמירה חלקית לשרת** — רענון/סגירה באמצע לא מאבדים כלום, והדשבורד רואה ליד "חלקי" תוך שניות.
- **דשבורד ניהול** (`admin.html`) — שליחת קמפיין, סטטיסטיקות קליקים/לידים, ייצוא CSV, קבוצות אנשי קשר.
- **2 פונקציות edge** — `send-sms-campaign` (שליחה דרך Inforu, מוגנת טוקן) + `admin-api` (API לדשבורד). מותקנות גם בשרת וגם בענן.
- **מיגרציות SQL** (`supabase/migrations/`) — 001–003 על פרויקט הענן (היסטורי), `004_central_integration.sql` הורצה על ה-DB המרכזי ב-19.7.

## 2. ארכיטקטורה

```
SMS (Inforu) ──► נמען לוחץ לינק אישי ──► index.html (GitHub Pages)
                                              │  log_web_click (RPC)
                                              │  submit_web_lead (RPC, מלא/חלקי)
                                              ▼
┌──────────────────────────────────────────────────────┐
│  DB מרכזי — self-hosted Supabase בשרת הלקוח          │
│  db.nahmanbot.com (Kong → PostgREST → Postgres)      │
│  טבלת leads המשותפת עם הבוט וה-CRM + sms_clicks,     │
│  sms_campaigns, contacts + RPCs + טריגרים            │
└──────────────────────────────────────────────────────┘
              ▲
              │   send-sms-campaign ──► Inforu API
              │   admin-api ◄── דשבורד (x-admin-token)
              │  שתיהן מדברות אל ה-DB המרכזי ב-service key שלו
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
- **פונקציות בשרת:** קבצי `index.ts` ב-`/root/supabase/volumes/functions/<name>/`
  ואז `docker restart supabase-edge-functions`.
- **פונקציות בענן (גיבוי):** `supabase functions deploy <name>` מול הפרויקט הישן.
- **מיגרציות ל-DB מרכזי:** `psql` דרך SSH לשרת, בעסקה אחת (`psql -1`), אחרי גיבוי סכמה.

## 7. בדיקות שבוצעו (19.7)

- רענון אמצע-פאנל: 3 תשובות → רענון → חזרה לשאלה 4 עם היסטוריה מלאה; ליד חלקי ב-DB; השלמה מעדכנת **אותה שורה**; מצב "הושלם" לאחר רענון. ✔
- מיגרציית 004: COMMIT נקי על ה-DB המרכזי, גיבוי לפני. ✔
- RPC דרך Kong של השרת: CORS 200, קליק + ליד מלא עם סיכום והחזר מס נכונים. ✔
- פונקציות מקומיות בשרת: `admin-api` עונה (groups/401 על טוקן שגוי), `send-sms-campaign` OPTIONS 204 — אומת בלוגים של ה-edge-runtime המקומי. ✔
- e2e דפדפן ל-DB מרכזי: קליק + ליד חלקי נרשמו בשרת (אומת ב-psql). כל דאטה הבדיקה נוקתה. ✔

## 8. העברת בעלות (Handover)

1. להעביר בעלות על הריפו + חשבון GitHub Pages (או להעביר דפים ל-hosting של הלקוח).
2. לסובב סודות (ראו §4): `ADMIN_TOKEN`, service key, טוקן Inforu אם צריך.
3. בעלות על פרויקט הענן `dgmygsvwemgtnvmdnwnz` (אופציונלי — גיבוי בלבד).
4. לוודא שהמתכנת הסיר את ה-Custom Domain מהענן (§5).
