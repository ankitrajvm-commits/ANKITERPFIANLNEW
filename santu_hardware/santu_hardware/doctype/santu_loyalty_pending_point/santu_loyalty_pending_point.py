# One row per DUE bill that earned loyalty points — tracks whether those
# points are Pending (bill still owed, inside the 2-day grace window),
# Active (bill was fully paid within 2 days — points are now redeemable),
# or Expired (2 days passed without full payment — points are gone for
# good). See santu_hardware.santu_hardware.loyalty_pending for the actual
# state machine; this file is just the Document shell Frappe requires.
#
# A bill that was NEVER due (paid in full at the counter) gets no row here
# at all — its points behave exactly as they always did, no gating.
from frappe.model.document import Document


class SantuLoyaltyPendingPoint(Document):
	pass
