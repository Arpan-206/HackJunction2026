"""Quaternion helpers. Quaternions are (x, y, z, w) tuples throughout."""

import math

Quat = tuple[float, float, float, float]
IDENTITY: Quat = (0.0, 0.0, 0.0, 1.0)


def normalise(q: Quat) -> Quat:
    """Return the unit quaternion, or identity for a zero quaternion."""
    n = math.sqrt(sum(v * v for v in q))
    if n == 0.0:
        return IDENTITY
    return (q[0] / n, q[1] / n, q[2] / n, q[3] / n)


def multiply(a: Quat, b: Quat) -> Quat:
    """Return the Hamilton product a * b."""
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    )


def conjugate(q: Quat) -> Quat:
    """Return the conjugate (the inverse for a unit quaternion)."""
    return (-q[0], -q[1], -q[2], q[3])


def from_axis_angle(axis: int, angle: float) -> Quat:
    """Return a rotation of angle radians about the x (0), y (1) or z (2) axis."""
    half = angle / 2.0
    v = [0.0, 0.0, 0.0]
    v[axis] = math.sin(half)
    return (v[0], v[1], v[2], math.cos(half))


def from_yaw_pitch_roll(yaw: float, pitch: float, roll: float) -> Quat:
    """Compose yaw (about y), then pitch (about x), then roll (about z)."""
    q = multiply(from_axis_angle(1, yaw), from_axis_angle(0, pitch))
    return normalise(multiply(q, from_axis_angle(2, roll)))


def nlerp(a: Quat, b: Quat, alpha: float) -> Quat:
    """Normalised linear interpolation from a to b along the shortest arc."""
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    sign = -1.0 if dot < 0.0 else 1.0
    mixed = tuple(x + alpha * (sign * y - x) for x, y in zip(a, b, strict=True))
    return normalise(mixed)  # type: ignore[arg-type]


def signed_angle(q: Quat, axis: int, sign: float = 1.0) -> float:
    """Return the rotation angle of q in (-pi, pi], signed by the chosen vector component."""
    q = normalise(q)
    vec = q[:3]
    angle = 2.0 * math.atan2(math.sqrt(sum(v * v for v in vec)), abs(q[3]))
    direction = vec[axis] * q[3]
    s = -1.0 if direction < 0.0 else 1.0
    return s * sign * angle
