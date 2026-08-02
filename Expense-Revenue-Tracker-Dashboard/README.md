# Expense Tracker Dashboard (Flask + pandas)

A self-hosted personal finance dashboard that reads your income and
expenses straight from two Excel files and turns them into an
interactive web report: KPIs, budget-vs-actual, category breakdown,
monthly trend, and a savings tracker — no database required.

**🔗 Live demo:** https://expense-revenue-tracker-dashboard.onrender.com

This is the same template you already had (Tailwind + Chart.js), but now the
data is NOT hardcoded in a JSON file. A local server (Flask) reads your
two Excel files with `pandas` every time the page requests them.

It's not Streamlit. It's a minimal server + your usual HTML.

## Run

Just open the link: **https://expense-revenue-tracker-dashboard.onrender.com**

## Add new data

1. Edit `Revenue_Tracker.xlsx` or `Expense_Tracker.xlsx` (they sit next to
   `app.py`) and add your rows as usual.
2. Save the Excel file.
3. Refresh the page in the browser (F5).

No need to restart the server or touch any code: every time the browser
requests `/api/data`, Flask reopens both Excel files with pandas and
recalculates everything from scratch (KPIs, categories, monthly trend,
table, top expenses, money leaks, savings gauge, plus the "All Year So
Far" summary for each year found in the data).

## Structure

```
dashboard_flask/
├── app.py                  <- Flask server: reads the Excel files with pandas
│                              and exposes /api/data
├── requirements.txt
├── Revenue_Tracker.xlsx    <- your income data (edit it freely)
├── Expense_Tracker.xlsx    <- your expense data (edit it freely)
└── static/
    ├── index.html          <- your original template, no design changes
    └── app.js              <- same logic as before + fetch to /api/data
```

## Notes

- `Revenue_Tracker.xlsx` and `Expense_Tracker.xlsx` must keep the same
  file name and stay in this folder (next to `app.py`, not inside `static/`).
- If you move or rename the Excel files, edit `REVENUE_FILE` / `EXPENSE_FILE`
  at the top of `app.py`.

## Deploying to Render

The repo already includes what Render needs: `Procfile`, `render.yaml`, and
`gunicorn` in `requirements.txt`.

1. Push this project to a GitHub (or GitLab) repo. **Make sure
   `Revenue_Tracker.xlsx` and `Expense_Tracker.xlsx` are committed** — they
   are not in `.gitignore`, so a normal `git add .` will include them.
2. On [render.com](https://render.com), click **New +** → **Blueprint**, and
   point it at your repo. Render will read `render.yaml` and configure
   everything automatically (build command, start command, Python version).
   - If you'd rather set it up by hand instead of using the Blueprint: **New +**
     → **Web Service** → your repo → Environment: `Python 3` → Build Command:
     `pip install -r requirements.txt` → Start Command:
     `gunicorn app:app --bind 0.0.0.0:$PORT`.
3. Deploy. Render gives you a public URL — this project is live at:
   **https://expense-revenue-tracker-dashboard.onrender.com**

**Important caveat about editing your data once it's deployed:** locally,
step 3 above ("edit the Excel, save, refresh the browser") works because
`app.py` reads the files straight off your disk. On Render's free tier, the
filesystem is ephemeral — any change you make to the Excel files *after*
deploying (e.g. uploading a new version through some other means) will be
lost the next time the service restarts or redeploys. In practice this means:

- To add new transactions, edit the Excel files locally, commit, and push —
  Render will redeploy with the updated data.
- If you want to edit the Excel files directly on the live site without a
  git push each time, you'd need a persistent disk (a paid Render feature)
  mounted at the app's directory, or switch to a small database instead of
  Excel files. Not needed for personal/local use, but worth knowing before
  you rely on the deployed version as your daily entry point.
