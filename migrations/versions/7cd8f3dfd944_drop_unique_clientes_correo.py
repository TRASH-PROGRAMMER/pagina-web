"""drop unique clientes correo

Revision ID: 7cd8f3dfd944
Revises: 
Create Date: 2026-04-02 23:33:16.769359

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7cd8f3dfd944'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'clientes_correo_key'
            ) THEN
                ALTER TABLE clientes DROP CONSTRAINT clientes_correo_key;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.create_unique_constraint('clientes_correo_key', 'clientes', ['correo'])
