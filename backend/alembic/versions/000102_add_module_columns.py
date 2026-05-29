"""add module + vendor to test_case_result

Revision ID: 000102
Revises: 000101
Create Date: 2026-05-28 17:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '000102'
down_revision: Union[str, None] = '000101'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('test_case_result', sa.Column('module', sa.String(), nullable=True))
    op.add_column('test_case_result', sa.Column('vendor', sa.String(), nullable=True))
    op.create_index(
        'idx_test_case_result_kind_module',
        'test_case_result',
        ['kind', 'module'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('idx_test_case_result_kind_module', table_name='test_case_result')
    op.drop_column('test_case_result', 'vendor')
    op.drop_column('test_case_result', 'module')
