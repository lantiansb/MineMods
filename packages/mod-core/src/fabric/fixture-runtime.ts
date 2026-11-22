/** Emitted only for projects with interactive fixture fields. */
export const fixtureRuntime = `    record Pending(long tick, int slot, int state, String owner) {}

    static Fight room(Mob actor) {
        Fight room = FIGHTS.get(actor.getUUID());
        return room != null && room.boss == actor ? room : null;
    }

    static int mask(Fight room, java.util.function.Predicate<StudioFixture> inside) {
        int mask = 0;
        if (room != null) for (int i = 0; i < room.fixtures.length; i++)
            if (room.fixtures[i] != null && inside.test(room.fixtures[i])) mask |= 1 << i;
        return mask;
    }

    static int litCount(Fight room, Entity origin, float yaw, double arc) {
        return Integer.bitCount(mask(room, fixture -> {
            if (!fixture.lit()) return false;
            double dx = fixture.getX() - origin.getX(), dz = fixture.getZ() - origin.getZ();
            if (arc >= 360 || dx * dx + dz * dz < 1.0e-12) return true;
            double bearing = Math.toDegrees(Math.atan2(-dx, dz));
            return Math.abs(Mth.wrapDegrees(bearing - yaw)) <= arc / 2.0 + 0.0005;
        }));
    }

    static int nearest(Fight room, Entity actor, int selected) {
        int best = 0;
        double distance = Double.POSITIVE_INFINITY;
        for (int i = 0; i < room.fixtures.length; i++) if ((selected & (1 << i)) != 0) {
            double next = room.fixtures[i].distanceToSqr(actor);
            if (next < distance) { best = 1 << i; distance = next; }
        }
        return best;
    }

    static double[] target(Fight room, Entity origin, boolean random) {
        if (room == null) return new double[0];
        int selected = litMask(room);
        if (selected == 0) return new double[0];
        if (random) {
            int skip = room.level.random.nextInt(Integer.bitCount(selected));
            while (skip-- > 0) selected &= selected - 1;
        } else selected = nearest(room, origin, selected);
        StudioFixture fixture = room.fixtures[Integer.numberOfTrailingZeros(selected)];
        return new double[] {fixture.getX(), fixture.getY(), fixture.getZ()};
    }

    static void change(Fight room, Entity origin, int selected, boolean closest, int state, int interval, String owner) {
        if (room == null) return;
        selected &= placedMask(room);
        if (closest) selected = nearest(room, origin, selected);
        long now = room.level.getGameTime();
        int ordinal = 0;
        for (int slot = 0; slot < room.fixtures.length; slot++) if ((selected & (1 << slot)) != 0) {
            int delay = ordinal++ * interval;
            if (delay == 0) apply(room, slot, state);
            else room.pending.add(new Pending(now + delay, slot, state, owner));
        }
    }

    static void apply(Fight room, int slot, int state) {
        StudioFixture fixture = room.fixtures[slot];
        if (state == 1) {
            if (!fixture.lit()) light(room, slot);
        } else if (fixture.lit() || fixture.ember() != (state == 2)) {
            if (state == 2) fixture.setEmber(); else fixture.setLit(false);
            room.readyAt[slot] = room.level.getGameTime() + room.spec.cooldown()[slot];
            if (!room.closing) look(room);
        }
    }

    static void cancel(Fight room, String owner) {
        if (room != null) room.pending.removeIf(next -> next.owner().equals(owner));
    }

    static void advance(Fight room) {
        if (room == null) return;
        long now = room.level.getGameTime();
        for (Iterator<Pending> it = room.pending.iterator(); it.hasNext();) {
            Pending next = it.next();
            if (room.closing && !next.owner().equals("death")) { it.remove(); continue; }
            if (next.tick() > now) continue;
            it.remove();
            apply(room, next.slot(), next.state());
        }
    }

    static void deathTick(Fight room) {
        if (room == null) return;
        room.seen = serverTick;
        room.closing = true;
        for (int slot = 0; slot < room.fixtures.length; slot++) {
            StudioFixture fixture = room.fixtures[slot];
            if (fixture != null && fixture.lit() && room.level.getGameTime() >= room.litUntil[slot]) apply(room, slot, 0);
        }
        if (room.fog) {
            room.fog = false;
            look(room);
        }
        advance(room);
    }

`
