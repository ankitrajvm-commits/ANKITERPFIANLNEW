"""Which site the test suites run on.

Default is the TEST COPY (scratch.local) -- never the live shop. To run a
suite on the live site on purpose: SANTU_TEST_SITE=site1.local (read-only
smoke only, see the full-app test plan)."""
import os

TEST_SITE = os.environ.get("SANTU_TEST_SITE", "scratch.local")
