# Stock Summary: what is in stock, what it cost, what it sells for — the
# three numbers together, which previously lived in three different places
# (quantity on the Items screen, cost behind Privacy Mode, selling price on
# the item form) while the Reports entry opened ERPNext's own Stock Balance
# report, which shows no selling price at all.
#
# Data comes from santu_hardware.api.get_stock_summary, called from
# santu_stock.js. This file exists only because Frappe's module loader
# expects a controller file alongside every Page's .json/.js pair.
