"""What each typed task returns (AD-3). Live and mock output are both parsed through these models."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

PROJECT_NAME_MAX = 100


class ProjectName(BaseModel):
    """`name_project`: a short name for a Project, from its first file (FR-4)."""

    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=PROJECT_NAME_MAX)]
