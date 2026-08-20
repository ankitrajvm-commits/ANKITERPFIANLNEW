# Doctor: one screen that checks the shop's setup and repairs what it can.
#
# All the logic lives in santu_hardware.santu_hardware.doctor so the checks can
# also be run from bench/cron later without going through a page. This file
# exists only because Frappe's module loader expects a controller alongside
# every Page's .json/.js pair.
