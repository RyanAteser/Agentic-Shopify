# Pilot numeric aggregation overflow safeguard

The offline merchant-value evaluator accepts finite nonnegative numeric cells, but IEEE-754 summation of multiple finite values can overflow to infinity. The evaluator now rejects nonfinite aggregate labor and provider cost, and rejects nonfinite merchant-weighted comparison arithmetic. It never reports an infinite savings or cost estimate as a valid pilot outcome.

Regression tests in `tests/test_merchant_value_pilot.py` cover labor and provider-cost overflow using two individually finite `1e308` inputs. Run `python -m unittest discover -s tests -p 'test_merchant*.py'` from the repository root. CI on the final commit is required; no merchant data was used.

This is a data-integrity guard, not evidence of labor savings, qualified organic traffic, conversion or revenue lift. Pilot assignments still require a preregistered manifest, complete labor observations, consent and independent outcome verification. No merchant store or external service is touched.
