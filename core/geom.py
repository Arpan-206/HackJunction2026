"""Small quaternion and vector helpers. Quaternions are x, y, z, w."""

from __future__ import annotations

import numpy as np

IDENTITY_Q = np.array([0.0, 0.0, 0.0, 1.0])


def normalize(v: np.ndarray, eps: float = 1e-12) -> np.ndarray:
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, eps)


def quat_normalize(q: np.ndarray) -> np.ndarray:
    q = np.asarray(q, dtype=float)
    n = np.linalg.norm(q)
    return q / n if n > 1e-12 else IDENTITY_Q.copy()


def quat_mul(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array(
        [
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz,
        ]
    )


def quat_conj(q: np.ndarray) -> np.ndarray:
    return np.array([-q[0], -q[1], -q[2], q[3]])


def quat_to_matrix(q: np.ndarray) -> np.ndarray:
    x, y, z, w = quat_normalize(q)
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )


def quat_from_matrix(m: np.ndarray) -> np.ndarray:
    m = np.asarray(m, dtype=float)
    tr = m[0, 0] + m[1, 1] + m[2, 2]
    if tr > 0:
        s = np.sqrt(tr + 1.0) * 2
        w = 0.25 * s
        x = (m[2, 1] - m[1, 2]) / s
        y = (m[0, 2] - m[2, 0]) / s
        z = (m[1, 0] - m[0, 1]) / s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        w = (m[2, 1] - m[1, 2]) / s
        x = 0.25 * s
        y = (m[0, 1] + m[1, 0]) / s
        z = (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        w = (m[0, 2] - m[2, 0]) / s
        x = (m[0, 1] + m[1, 0]) / s
        y = 0.25 * s
        z = (m[1, 2] + m[2, 1]) / s
    else:
        s = np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        w = (m[1, 0] - m[0, 1]) / s
        x = (m[0, 2] + m[2, 0]) / s
        y = (m[1, 2] + m[2, 1]) / s
        z = 0.25 * s
    return quat_normalize(np.array([x, y, z, w]))


def quat_from_axis_angle(axis: np.ndarray, angle_rad: float) -> np.ndarray:
    axis = normalize(np.asarray(axis, dtype=float))
    s = np.sin(angle_rad / 2)
    return np.array([axis[0] * s, axis[1] * s, axis[2] * s, np.cos(angle_rad / 2)])


def rotate(q: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Rotate vector(s) v (..., 3) by quaternion q."""
    return np.asarray(v, dtype=float) @ quat_to_matrix(q).T


def rotate_inv(q: np.ndarray, v: np.ndarray) -> np.ndarray:
    return np.asarray(v, dtype=float) @ quat_to_matrix(q)


def angle_between_deg(u: np.ndarray, v: np.ndarray) -> float:
    nu, nv = np.linalg.norm(u), np.linalg.norm(v)
    if nu < 1e-9 or nv < 1e-9:
        return 0.0
    c = float(np.dot(u, v) / (nu * nv))
    return float(np.degrees(np.arccos(np.clip(c, -1.0, 1.0))))


def yaw_quat(yaw_rad: float) -> np.ndarray:
    return quat_from_axis_angle(np.array([0.0, 1.0, 0.0]), yaw_rad)


class OneEuroFilter:
    """One Euro filter for a vector signal. min_cutoff in Hz, beta unitless."""

    def __init__(
        self, min_cutoff: float = 1.5, beta: float = 0.05, d_cutoff: float = 1.0
    ) -> None:
        self.min_cutoff = float(min_cutoff)
        self.beta = float(beta)
        self.d_cutoff = float(d_cutoff)
        self._x: np.ndarray | None = None
        self._dx: np.ndarray | None = None
        self._t_us: int | None = None

    @staticmethod
    def _alpha(cutoff: float, dt: float) -> float:
        tau = 1.0 / (2 * np.pi * cutoff)
        return 1.0 / (1.0 + tau / dt)

    def reset(self) -> None:
        self._x = self._dx = None
        self._t_us = None

    def __call__(self, x: np.ndarray, t_us: int) -> np.ndarray:
        x = np.asarray(x, dtype=float)
        if self._x is None or self._t_us is None or t_us <= self._t_us:
            self._x = x.copy()
            self._dx = np.zeros_like(x)
            self._t_us = t_us
            return x
        dt = (t_us - self._t_us) / 1e6
        self._t_us = t_us
        dx = (x - self._x) / dt
        a_d = self._alpha(self.d_cutoff, dt)
        self._dx = a_d * dx + (1 - a_d) * self._dx
        cutoff = self.min_cutoff + self.beta * float(np.linalg.norm(self._dx))
        a = self._alpha(cutoff, dt)
        self._x = a * x + (1 - a) * self._x
        return self._x.copy()
