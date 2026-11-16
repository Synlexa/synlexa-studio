"""Python SDK for Synlexa Studio (Research-Use-Only)."""

from .client import ComputeNodeClient, SynlexaCliError, SynlexaStudioClient

__version__ = "0.4.2"
RUO_NOTICE = (
    "Research-Use-Only (RUO). Outputs are computational estimates for exploratory "
    "research and must not be used for diagnostic, therapeutic, or clinical decisions."
)

__all__ = [
    "__version__",
    "RUO_NOTICE",
    "SynlexaCliError",
    "SynlexaStudioClient",
    "ComputeNodeClient",
]
