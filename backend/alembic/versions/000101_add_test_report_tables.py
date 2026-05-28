"""add test report tables

Revision ID: 000101
Revises: 000100
Create Date: 2026-05-28 14:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '000101'
down_revision: Union[str, None] = '000100'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'test_run',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(), nullable=False),
        sa.Column('bucket', sa.String(), nullable=False),
        sa.Column('source_path', sa.Text(), nullable=False),
        sa.Column('build_number', sa.Integer(), nullable=False),
        sa.Column('suite', sa.String(), nullable=True),
        sa.Column('repo_path', sa.String(), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('run_date', sa.Date(), nullable=False),
        sa.Column('duration_ms', sa.Integer(), nullable=True),
        sa.Column('total', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('passed', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('failed', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('skipped', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('flaky', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('errors', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('success_rate', sa.Numeric(6, 3), nullable=True),
        sa.Column('ok', sa.Boolean(), nullable=True),
        sa.Column('top_level_error', sa.Text(), nullable=True),
        sa.Column('ingested_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('source_path', name='uq_test_run_source_path'),
    )
    op.create_index('idx_test_run_kind_run_date', 'test_run', ['kind', 'run_date'], unique=False)
    op.create_index('idx_test_run_suite_run_date', 'test_run', ['suite', 'run_date'], unique=False)

    op.create_table(
        'test_case_result',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('run_id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(), nullable=False),
        sa.Column('test_name', sa.Text(), nullable=False),
        sa.Column('test_file', sa.Text(), nullable=True),
        sa.Column('test_line', sa.Integer(), nullable=True),
        sa.Column('class_fqn', sa.Text(), nullable=True),
        sa.Column('package_name', sa.Text(), nullable=True),
        sa.Column('suite_path', sa.Text(), nullable=True),
        sa.Column('project_name', sa.String(), nullable=True),
        sa.Column('tags', postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('outcome', sa.String(), nullable=True),
        sa.Column('ok', sa.Boolean(), nullable=True),
        sa.Column('retry', sa.Integer(), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('duration_ms', sa.BigInteger(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('error_stack', sa.Text(), nullable=True),
        sa.Column('error_snippet', sa.Text(), nullable=True),
        sa.Column('step_count', sa.Integer(), nullable=True),
        sa.Column('attachment_names', postgresql.ARRAY(sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(['run_id'], ['test_run.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_test_case_result_run', 'test_case_result', ['run_id'], unique=False)
    op.create_index('idx_test_case_result_kind_status', 'test_case_result', ['kind', 'status'], unique=False)
    op.create_index('idx_test_case_result_kind_name_started', 'test_case_result', ['kind', 'test_name', 'started_at'], unique=False)


def downgrade() -> None:
    op.drop_index('idx_test_case_result_kind_name_started', table_name='test_case_result')
    op.drop_index('idx_test_case_result_kind_status', table_name='test_case_result')
    op.drop_index('idx_test_case_result_run', table_name='test_case_result')
    op.drop_table('test_case_result')
    op.drop_index('idx_test_run_suite_run_date', table_name='test_run')
    op.drop_index('idx_test_run_kind_run_date', table_name='test_run')
    op.drop_table('test_run')
