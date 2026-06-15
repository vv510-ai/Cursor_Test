"""测试桩:在未安装 sqlalchemy 的精简环境中注入"最小内存 ORM",
覆盖本项目实际用到的 API 面(DeclarativeBase/mapped_column/Session.get/add/merge/
commit/execute(select(...).where().order_by().limit())/query().filter().order_by().limit().all())。
真实环境(已 pip install -r requirements.txt)中本模块不做任何事,测试跑在真 SQLAlchemy + SQLite 上。
"""
from __future__ import annotations

import sys
import types


def _make_sqlalchemy_stub():
    sa = types.ModuleType("sqlalchemy")
    orm = types.ModuleType("sqlalchemy.orm")

    # ---------- 列类型占位 ----------
    def _coltype(*a, **k):
        return None
    for name in ("JSON", "DateTime", "Float", "ForeignKey", "Integer", "String", "Text", "Boolean"):
        setattr(sa, name, _coltype)

    # ---------- 条件与排序对象 ----------
    class _Cond:
        def __init__(self, attr, op, value):
            self.attr, self.op, self.value = attr, op, value

        def __call__(self, obj):
            v = getattr(obj, self.attr, None)
            return v == self.value if self.op == "eq" else v != self.value

    class _Sort:
        def __init__(self, attr, desc=False):
            self.attr, self.desc = attr, desc

    class _Attr:
        def __init__(self, name):
            self.name = name

        def __eq__(self, other):  # type: ignore[override]
            return _Cond(self.name, "eq", other)

        def __ne__(self, other):  # type: ignore[override]
            return _Cond(self.name, "ne", other)

        def desc(self):
            return _Sort(self.name, True)

        def asc(self):
            return _Sort(self.name, False)

        def is_(self, other):
            return _Cond(self.name, "eq", other)

        def __hash__(self):
            return hash(self.name)

    class _MappedColumn:
        def __init__(self, *a, **k):
            self.default = k.get("default")
            self.autoincrement = k.get("autoincrement", False)
            self.primary_key = k.get("primary_key", False)

    def mapped_column(*a, **k):
        return _MappedColumn(*a, **k)

    # ---------- 声明基类:类属性→_Attr,实例化填默认值 ----------
    _TABLES: dict[type, list] = {}
    _AUTO: dict[type, int] = {}

    class _Meta(type):
        def __new__(mcls, name, bases, ns):
            cols = {k: v for k, v in ns.items() if isinstance(v, _MappedColumn)}
            ns["__cols__"] = cols
            pk = [k for k, v in cols.items() if v.primary_key]
            ns["__pk__"] = pk[0] if pk else "id"
            cls = super().__new__(mcls, name, bases, ns)
            if name != "Base":
                _TABLES[cls] = []
                _AUTO[cls] = 0
                for k in cols:
                    setattr(cls, k, _Attr(k))
            return cls

    class Base(metaclass=_Meta):
        def __init__(self, **kw):
            for k, col in type(self).__cols__.items():
                if k in kw:
                    setattr(self, k, kw[k])
                elif col.autoincrement:
                    _AUTO[type(self)] += 1
                    setattr(self, k, _AUTO[type(self)])
                else:
                    d = col.default
                    setattr(self, k, d() if callable(d) else d)

        class metadata:  # noqa: N801
            @staticmethod
            def create_all(engine):
                return None

    class DeclarativeBase(Base):
        pass

    # ---------- select / query ----------
    class _Select:
        def __init__(self, model):
            self.model, self.conds, self.sorts, self._limit = model, [], [], None

        def where(self, *conds):
            self.conds += list(conds)
            return self

        filter = where

        def order_by(self, *sorts):
            self.sorts += list(sorts)
            return self

        def limit(self, n):
            self._limit = n
            return self

        def _rows(self):
            rows = [r for r in _TABLES.get(self.model, [])
                    if all(c(r) for c in self.conds)]
            for s in reversed(self.sorts):
                rows.sort(key=lambda r: getattr(r, s.attr) or 0, reverse=s.desc)
            return rows[: self._limit] if self._limit else rows

        # query() 风格终结符
        def all(self):
            return self._rows()

        def count(self):
            return len(self._rows())

        def first(self):
            rows = self._rows()
            return rows[0] if rows else None

    def select(model):
        return _Select(model)

    class _ScalarResult:
        def __init__(self, rows):
            self._rows = rows

        def all(self):
            return self._rows

        def first(self):
            return self._rows[0] if self._rows else None

    class _ExecResult(_ScalarResult):
        def scalars(self):
            return _ScalarResult(self._rows)

    class Session:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def get(self, model, pk):
            key = model.__pk__
            for r in _TABLES.get(model, []):
                if getattr(r, key, None) == pk:
                    return r
            return None

        def add(self, obj):
            _TABLES[type(obj)].append(obj)

        def add_all(self, objs):
            for o in objs:
                self.add(o)

        def merge(self, obj):
            old = self.get(type(obj), getattr(obj, type(obj).__pk__))
            if old is not None:
                _TABLES[type(obj)].remove(old)
            self.add(obj)
            return obj

        def delete(self, obj):
            _TABLES[type(obj)].remove(obj)

        def commit(self):
            return None

        def execute(self, sel: _Select):
            return _ExecResult(sel._rows())

        def query(self, model):
            return _Select(model)

        def close(self):
            return None

    def sessionmaker(bind=None, **k):
        return lambda: Session()

    def create_engine(url, **k):
        return types.SimpleNamespace(url=url)

    sa.select = select
    sa.create_engine = create_engine
    orm.DeclarativeBase = DeclarativeBase
    orm.Session = Session
    orm.sessionmaker = sessionmaker
    orm.Mapped = dict  # 仅作类型注解占位
    orm.mapped_column = mapped_column
    sa.orm = orm
    return sa, orm


def install() -> None:
    """缺什么补什么;真实依赖存在时绝不覆盖。"""
    try:
        import sqlalchemy  # noqa: F401
    except ImportError:
        sa, orm = _make_sqlalchemy_stub()
        sys.modules["sqlalchemy"] = sa
        sys.modules["sqlalchemy.orm"] = orm
