"""
Financial Tracker Web API Application.
Parses local Excel workbooks and outputs consolidated financial analytics via REST.
"""

from pathlib import Path
from typing import Dict, Any
import pandas as pd
from flask import Flask, jsonify, send_from_directory

# Base directory configuration
APP_DIR = Path(__file__).parent
STATIC_DIR = APP_DIR / "static"
REVENUE_FILE = APP_DIR / "Revenue_Tracker.xlsx"
EXPENSE_FILE = APP_DIR / "Expense_Tracker.xlsx"

# Monthly allocation budgets (USD) per category
BUDGETS: Dict[str, float] = {
    "Housing": 300.0,
    "Utilities": 20.0,
    "Groceries": 250.0,
    "Dining": 30.0,
    "Health & Fitness": 30.0,
    "Shopping & Personal": 30.0,
    "Subscriptions & Software": 20.0,
    "Supplies": 10.0,
    "Travel & Entertainment": 10.0,
    "Education & Training": 10.0,
    "Other": 10.0,
    "Lottery": 10.0,
}

# Exclusion category for future planning projections
PLANNING_CATEGORY = "Planning Expense"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")


def load_log(path: Path) -> pd.DataFrame:
    """Reads, cleans, and standardizes financial log sheets from Excel workbooks."""
    xls = pd.ExcelFile(path)
    sheet = "Expense Log" if "Expense Log" in xls.sheet_names else xls.sheet_names[0]

    df = pd.read_excel(path, sheet_name=sheet, skiprows=4)
    df = df.dropna(subset=["Date", "Amount ($)"])

    # Sanitize string input fields
    df["Description / Concept"] = df["Description / Concept"].astype(str).str.strip()
    df["Category"] = df["Category"].astype(str).str.strip()
    df["Payment Method"] = df["Payment Method"].astype(str).str.strip()
    df["Amount ($)"] = pd.to_numeric(df["Amount ($)"], errors="coerce")
    df = df.dropna(subset=["Amount ($)"])

    df = df.rename(columns={
        "Description / Concept": "description",
        "Category": "category",
        "Payment Method": "paymentMethod",
        "Amount ($)": "amount",
        "Date": "date_raw",
    })

    # Temporal conversions
    df["date_raw"] = pd.to_datetime(df["date_raw"])
    df["month_key"] = df["date_raw"].dt.strftime("%B %Y")
    df["year_key"] = df["date_raw"].dt.strftime("%Y")
    df["date"] = df["date_raw"].dt.strftime("%b %d, %Y")

    return df[["date", "date_raw", "month_key", "year_key", "description", "category", "paymentMethod", "amount"]]


def _build_period_entry(exp_all_m, inc_m):
    """Builds one KPI/table/chart-ready entry (shared shape for months AND year summaries)."""
    is_planning = exp_all_m["category"] == PLANNING_CATEGORY
    planning_m = exp_all_m[is_planning]
    exp_m = exp_all_m[~is_planning]

    planning_items = [
        {"description": row["description"], "amount": round(float(row["amount"]), 2)}
        for _, row in planning_m.iterrows()
    ]
    planning_total = round(float(planning_m["amount"].sum()), 2)

    total_expense = round(float(exp_m["amount"].sum()), 2)
    total_income = round(float(inc_m["amount"].sum()), 2)
    savings = round(total_income - total_expense, 2)
    savings_rate = round((savings / total_income) * 100, 1) if total_income > 0 else 0.0

    cat_expenses = {}
    for cat, amt in exp_m.groupby("category")["amount"].sum().sort_values(ascending=False).items():
        cat_expenses[cat] = round(float(amt), 2)

    expenses_table = [
        {
            "date": row["date"],
            "description": row["description"],
            "category": row["category"],
            "paymentMethod": row["paymentMethod"],
            "amount": round(float(row["amount"]), 2),
        }
        for _, row in exp_m.iterrows()
    ]

    return {
        "income": total_income,
        "expense": total_expense,
        "savings": savings,
        "savings_rate": savings_rate,
        "category_expenses": cat_expenses,
        "expenses_table": expenses_table,
        "planning_expenses": {"total": planning_total, "items": planning_items},
    }


def build_excel_data() -> Dict[str, Any]:
    """Processes historical log entries into structured, JSON-serializable payloads.

    Returns a dict with two top-level buckets:
    - "months": one entry per calendar month found in the data (unchanged behavior).
    - "years": one entry per calendar year found in the data, aggregating every month
      seen so far for that year (used by the "All Year So Far" selector option).
    """
    expenses = load_log(EXPENSE_FILE)
    income = load_log(REVENUE_FILE)

    months = sorted(
        set(expenses["month_key"]) | set(income["month_key"]),
        key=lambda m: pd.to_datetime(m, format="%B %Y"),
    )

    result = {}
    carryover = {cat: 0.0 for cat in BUDGETS}

    # Snapshot of the rollover state right before the first month of each year is
    # processed. Needed later to build the "All Year So Far" budget comparison the
    # same way each month does it (available_budget = base_budget + carryover).
    year_start_carryover: Dict[str, Dict[str, float]] = {}
    month_count_by_year: Dict[str, int] = {}

    for m in months:
        exp_all_m = expenses[expenses["month_key"] == m].sort_values("date_raw")
        inc_m = income[income["month_key"] == m]

        year_key = str(pd.to_datetime(m, format="%B %Y").year)
        if year_key not in year_start_carryover:
            year_start_carryover[year_key] = dict(carryover)
        month_count_by_year[year_key] = month_count_by_year.get(year_key, 0) + 1

        entry = _build_period_entry(exp_all_m, inc_m)

        # Calculate budget utilization vs allocations (with rollover)
        budget_vs_actual = {}
        for cat, base_budget in BUDGETS.items():
            actual = entry["category_expenses"].get(cat, 0.0)
            available_budget = round(base_budget + carryover[cat], 2)
            remaining = round(available_budget - actual, 2)

            budget_vs_actual[cat] = {
                "base_budget": base_budget,
                "available_budget": available_budget,
                "actual": actual,
            }
            carryover[cat] = remaining

        entry["budget_vs_actual"] = budget_vs_actual
        result[m] = entry

    # ------------------------------------------------------------------
    # "All Year So Far" summaries: one aggregated entry per calendar year,
    # combining every month of that year found in the data up to now.
    # ------------------------------------------------------------------
    years_result: Dict[str, Any] = {}
    for year_key in sorted(month_count_by_year.keys()):
        exp_year = expenses[expenses["date_raw"].dt.strftime("%Y") == year_key].sort_values("date_raw")
        inc_year = income[income["date_raw"].dt.strftime("%Y") == year_key]

        entry = _build_period_entry(exp_year, inc_year)

        # Budget vs Actual for the year: straight annual allocation (base_budget per
        # month times the number of months seen so far) plus whatever rollover had
        # already accumulated before this year started -- no rollover is added
        # *within* the year here, since "actual" already reflects the full-year spend.
        n_months = month_count_by_year[year_key]
        budget_vs_actual = {}
        for cat, base_budget in BUDGETS.items():
            base_budget_year = round(base_budget * n_months, 2)
            available_budget = round(base_budget_year + year_start_carryover[year_key][cat], 2)
            actual = entry["category_expenses"].get(cat, 0.0)
            budget_vs_actual[cat] = {
                "base_budget": base_budget_year,
                "available_budget": available_budget,
                "actual": actual,
            }

        entry["budget_vs_actual"] = budget_vs_actual
        entry["months_included"] = n_months
        years_result[year_key] = entry

    return {"months": result, "years": years_result}


@app.route("/")
def index():
    """Serves the static client application entrypoint."""
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/api/data")
def api_data():
    """Primary REST endpoint yielding structured data analytics."""
    missing = [f.name for f in (REVENUE_FILE, EXPENSE_FILE) if not f.exists()]
    if missing:
        return jsonify({"error": f"Missing required files: {', '.join(missing)}"}), 404
    try:
        return jsonify(build_excel_data())
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    # Render (and most hosts) inject the port to bind via the PORT env var and
    # require binding to 0.0.0.0 instead of 127.0.0.1. Locally, this still
    # defaults to 127.0.0.1:5000 exactly like before.
    import os
    port = int(os.environ.get("PORT", 5000))
    host = "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1"
    app.run(host=host, port=port, debug=False)