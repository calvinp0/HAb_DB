from __future__ import annotations
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from sqlalchemy import create_engine
from alembic import context

from db.models import Base
from db.engine import DATABASE_URL
import logging
logger = logging.getLogger("alembic.env")
logger.info(f"[alembic] DATABASE_URL -> {DATABASE_URL}")

from alembic.autogenerate import renderers
from db.models import Mol

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
# from myapp import mymodel
# target_metadata = mymodel.Base.metadata
target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


@renderers.dispatch_for(Mol)
def _render_mol_type(autogen_context, self):
    autogen_context.imports.add("from db.models import Mol")
    return "Mol()"

def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = DATABASE_URL
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # create the Engine and immediately enter a transactional connection scope
    connectable = create_engine(DATABASE_URL, poolclass=pool.NullPool, future=True)

    # IMPORTANT: use connectable.begin() so the transaction is tied to the connection context
    with connectable.begin() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            render_as_batch=False,
        )
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
