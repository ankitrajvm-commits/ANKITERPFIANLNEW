"""One-off: create Frappe session for Playwright UI tests."""
import json
import os
from types import SimpleNamespace

import frappe


def create_session():
	frappe.local.request_ip = "127.0.0.1"
	frappe.local.form_dict = frappe._dict()
	frappe.local.request = SimpleNamespace(cookies={"sid": "Guest"})
	from frappe.sessions import Session

	s = Session(user="Administrator", resume=False)
	return {"sid": s.sid, "user": s.user}


def main():
	out = create_session()
	path = os.path.join(os.path.dirname(__file__), "tmp_santu_ui_session.json")
	with open(path, "w") as f:
		json.dump(out, f)
	print(json.dumps(out))


if __name__ == "__main__":
	main()
