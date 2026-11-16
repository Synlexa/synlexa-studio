from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

JobStatus = Literal["queued", "running", "completed", "failed", "cancelled"]


@dataclass
class GpuDeviceInfo:
    index: int
    name: str
    backend: Literal["cuda", "metal", "rocm", "opencl"]
    vram_mb: int | None = None
    driver_version: str | None = None


@dataclass
class ToolCapability:
    id: str
    name: str
    category: str
    license: str
    commercial_safe: bool
    installed: bool
    version: str | None
    install_hint: str
    requires_gpu: bool = False


@dataclass
class HardwareCapabilities:
    hostname: str
    os_name: str
    arch: str
    python_version: str
    cpu_cores: int
    ram_mb: int | None
    gpus: list[GpuDeviceInfo] = field(default_factory=list)
    tools: list[ToolCapability] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ArtifactRecord:
    name: str
    format: str
    mime_type: str
    size_bytes: int
    sha256: str
    created_at_utc: str


@dataclass
class JobRecord:
    job_id: str
    tool_id: str
    status: JobStatus
    created_at_utc: str
    started_at_utc: str | None = None
    finished_at_utc: str | None = None
    progress: float = 0.0
    stage: str = "queued"
    tool_version: str | None = None
    metrics: dict[str, Any] = field(default_factory=dict)
    logs: list[str] = field(default_factory=list)
    artifacts: list[ArtifactRecord] = field(default_factory=list)
    error_code: str | None = None
    error_message: str | None = None
    ruo_notice: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
