import { TERRAIN_BLOCKS, type TerrainEvent } from "../terrain"
import type { GenTarget } from "../platform/adapter"
export function terrainStatement(e: TerrainEvent, origin: string, scale: string, context = { world: "level()", yaw: "abilityYaw", owner: "this", terrain: "StudioTerrain" }) {
  // A negative forward written as "-" + "-3.0000" would be Java's decrement operator; negate it here instead. Zero and positive values keep their old text.
  const back = e.forward < 0 ? (-e.forward).toFixed(4) : `-${e.forward.toFixed(4)}`
  const p = `${origin}.add(${back} * Mth.sin(${context.yaw} * Mth.DEG_TO_RAD) + ${e.left.toFixed(4)} * Mth.cos(${context.yaw} * Mth.DEG_TO_RAD), 0.0, ${e.forward.toFixed(4)} * Mth.cos(${context.yaw} * Mth.DEG_TO_RAD) + ${e.left.toFixed(4)} * Mth.sin(${context.yaw} * Mth.DEG_TO_RAD))`
  return e.type === "terrain_rise"
    ? `${context.terrain}.rise(${context.world}, ${p}, ${context.yaw}, "${e.shape}", ${e.width}, ${e.height}, ${Math.round(e.rise_seconds * 20)}, ${Math.round(e.stay_seconds * 20)}, ${e.lifts}, ${(e.damage ?? 0).toFixed(4)}f * ${scale}, ${e.knockback ?? 0}, ${e.shatter}, ${context.owner}${e.restore_on_exit || e.blocks || e.hardness !== undefined ? `, ${e.taper ?? 1}, ${JSON.stringify(e.material ?? null)}, new ${context.terrain}.Traits(${(e.blocks?.beam?1:0)|(e.blocks?.area?2:0)|(e.blocks?.projectile?4:0)}, ${e.hardness ?? -1}, ${e.restore_on_exit === true})` : e.material ? `, ${e.taper ?? 1}, "${e.material}"` : e.taper === undefined ? "" : `, ${e.taper.toFixed(4)}`});`
    : `${context.terrain}.swap(${context.world}, ${p}, "${e.block}", "${e.area.shape}", ${e.area.radius}, ${e.area.height}, ${Math.round(e.restore_after * 20)}, "${(e.only_replace ?? ["soft", "liquid"]).join(",")}"${e.restore_on_exit ? `, ${context.owner}` : ""});`
}
export function terrainSource(pkg: string, modId: string, target: GenTarget, pointed = false, terrainMaterial = false, interactions = false) {
  const old = target.version.minecraft === "1.20.1"
  const facade = target.loader.facade
  const register = facade
    ? "StudioPlatform.onServerTick(StudioTerrain::tick);"
    : "net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents.END_SERVER_TICK.register(StudioTerrain::tick);"
  return `package ${pkg}.entity;
import java.util.*;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.particles.BlockParticleOption;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.nbt.*;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.*;
import net.minecraft.world.level.*;
import net.minecraft.world.level.block.*;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.world.phys.*;
${facade ? `import ${pkg}.platform.StudioPlatform;` : ""}

/** Temporary terrain shared by abilities and other server callers. Never drops items. */
public final class StudioTerrain {
    private static final Set<String> TARGETS = Set.of(${TERRAIN_BLOCKS.map((s) => JSON.stringify(s)).join(",")});
    private static final String LEDGER = "${modId}_terrain";
    private static final Map<StudioFxSpec, double[]> POP = new WeakHashMap<>();
    private static final Map<StudioFx, Set<Long>> SWEPT = new WeakHashMap<>();
    private static final List<StudioTerrainPart> PARTS = new ArrayList<>();
    ${interactions ? `public record Traits(int stops,double hardness,boolean restore) {}
    public record Contact(String kind,StudioTerrainPart part) {}
    public static Contact contact(Entity actor,Vec3 delta) {
        if(delta.horizontalDistanceSqr()<1e-8) return null;
        AABB base=actor.getBoundingBox().deflate(0.005);
        AABB swept=base.expandTowards(delta);
        Vec3 from=base.getCenter(), to=from.add(delta);
        double halfX=base.getXsize()/2,halfY=base.getYsize()/2,halfZ=base.getZsize()/2;
        double nearest=Double.POSITIVE_INFINITY; Contact found=null;
        for(var shape:actor.level().getBlockCollisions(actor,swept)) for(AABB b:shape.toAabbs()) {
            AABB expanded=b.inflate(halfX,halfY,halfZ);
            Vec3 p=expanded.contains(from)?from:expanded.clip(from,to).orElse(null);
            if(p!=null && from.distanceToSqr(p)<nearest) {nearest=from.distanceToSqr(p);found=new Contact("world",null);}
        }
        for(StudioTerrainPart e:PARTS) {
            if(e.level()!=actor.level() || !e.canBeCollidedWith() || !swept.intersects(e.getBoundingBox())) continue;
            AABB expanded=e.getBoundingBox().inflate(halfX,halfY,halfZ);
            Vec3 p=expanded.contains(from)?from:expanded.clip(from,to).orElse(null);
            if(p!=null && from.distanceToSqr(p)<nearest) { nearest=from.distanceToSqr(p); found=new Contact(e.ownedBy(actor)?"own_terrain":"other_terrain",e); }
        }
        return found;
    }
    public static int smash(Level world,double power,java.util.function.Predicate<StudioTerrainPart> meets) {
        Set<Set<UUID>> groups=Collections.newSetFromMap(new IdentityHashMap<>());
        for(StudioTerrainPart e:PARTS) if(e.level()==world && e.canBreak(power) && meets.test(e)) groups.add(e.group());
        if(groups.isEmpty()) return 0;
        for(StudioTerrainPart e:List.copyOf(PARTS)) if(e.level()==world && groups.contains(e.group()) && !e.isRemoved()) e.crumble();
        return groups.size();
    }
    public static boolean inCylinder(AABB box,Vec3 center,double radius,double height) {
        double dx=Math.max(0,Math.max(box.minX-center.x,center.x-box.maxX)), dz=Math.max(0,Math.max(box.minZ-center.z,center.z-box.maxZ));
        return dx*dx+dz*dz<=radius*radius && box.maxY>=center.y && box.minY<=center.y+height;
    }
    public static Optional<Vec3> clip(Level world,Vec3 from,Vec3 to,int kind) {
        Vec3 closest=null; double nearest=Double.POSITIVE_INFINITY;
        for(StudioTerrainPart e:PARTS) {
            if(e.level()!=world || !e.blocks(kind)) continue;
            AABB box=e.getBoundingBox();
            Vec3 hit=box.contains(from)?from:box.clip(from,to).orElse(null);
            if(hit!=null && from.distanceToSqr(hit)<nearest) { closest=hit;nearest=from.distanceToSqr(hit); }
        }
        return Optional.ofNullable(closest);
    }
    ` : ""}public static void register() { ${register} }
    public static StudioFxSpec popSpec(StudioFxSpec spec, double height, int every, int max) { POP.put(spec, new double[]{height,every,max}); return spec; }
    public static void sweep(StudioFx fx, StudioFxSpec spec, int age) {
        double[] pop=POP.get(spec);
        if(pop==null || age % (int)pop[1]!=0 || !(fx.level() instanceof ServerLevel world)) return;
        Set<Long> seen=SWEPT.computeIfAbsent(fx,k->new HashSet<>());
        double outer=fx.ringRadius(age), inner=fx.ringRadius(Math.max(0,age-(int)pop[1]));
        int extent=(int)Math.ceil(outer+1);
        for(int x=-extent;x<=extent && seen.size()<(int)pop[2];x++) for(int z=-extent;z<=extent && seen.size()<(int)pop[2];z++) {
            double d=Math.hypot(x,z); if(d<inner-0.5 || d>outer+0.5) continue;
            BlockPos at=ground(world,fx.position().add(x,0,z));
            if(at==null || !world.getBlockState(at.above()).isAir() || seen.contains(at.asLong())) continue;
            BlockState state=world.getBlockState(at);
            if(state.hasBlockEntity() || !state.isCollisionShapeFullBlock(world,at)) continue;
            if(part(world,state,at.getX(),at.getY(),at.getZ(),1,1,16,0,false,0,0,false,null,pop[0])!=null) seen.add(at.asLong());
        }
    }
    private static BlockPos ground(ServerLevel w, Vec3 p) {
        for(int d=0;d<=8;d++) {
            BlockPos at=BlockPos.containing(p.x,p.y-0.01-d,p.z);
            if(!w.hasChunkAt(at)) return null;
            BlockState s=w.getBlockState(at);
            if(!s.hasBlockEntity() && s.getFluidState().isEmpty() && s.isCollisionShapeFullBlock(w,at) && s.getDestroySpeed(w,at)>=0) return at;
        }
        return null;
    }
    private static BlockState material(BlockState s) {
        String name=BuiltInRegistries.BLOCK.getKey(s.getBlock()).getPath();
        if(name.contains("ore")) return (name.contains("deepslate")?Blocks.DEEPSLATE:Blocks.STONE).defaultBlockState();
        if(s.is(Blocks.GRASS_BLOCK)||s.is(Blocks.MYCELIUM)||s.is(Blocks.PODZOL)) return Blocks.DIRT.defaultBlockState();
        if(s.is(Blocks.SAND)) return Blocks.SANDSTONE.defaultBlockState();
        if(s.is(Blocks.RED_SAND)) return Blocks.RED_SANDSTONE.defaultBlockState();
        if(s.is(Blocks.GRAVEL)) return Blocks.STONE.defaultBlockState();
        return s;
    }
    public static void rise(Level level, Vec3 p, float yaw, String shape, double width, double height, int grow, int stay, boolean lifts, float damage, double knockback, boolean shatter, Entity owner) {${pointed ? `
        rise(level,p,yaw,shape,width,height,grow,stay,lifts,damage,knockback,shatter,owner,1.0);
    }
    public static void rise(Level level, Vec3 p, float yaw, String shape, double width, double height, int grow, int stay, boolean lifts, float damage, double knockback, boolean shatter, Entity owner, double taper) {${terrainMaterial ? `
        rise(level,p,yaw,shape,width,height,grow,stay,lifts,damage,knockback,shatter,owner,taper,null);
    }
    public static void rise(Level level, Vec3 p, float yaw, String shape, double width, double height, int grow, int stay, boolean lifts, float damage, double knockback, boolean shatter, Entity owner, double taper,String surface) {${interactions ? `
        rise(level,p,yaw,shape,width,height,grow,stay,lifts,damage,knockback,shatter,owner,taper,surface,null);
    }
    public static void rise(Level level, Vec3 p, float yaw, String shape, double width, double height, int grow, int stay, boolean lifts, float damage, double knockback, boolean shatter, Entity owner,double taper,String surface,Traits traits) {` : ""}` : ""}` : ""}
        if(!(level instanceof ServerLevel w) || !Double.isFinite(width)||!Double.isFinite(height)||!Float.isFinite(damage)||!Double.isFinite(knockback)||width<0.5||width>8||height<0.5||height>12||grow<2||grow>100||stay<0||stay>600||damage<0||damage>100||knockback<0||knockback>4||!Set.of("column","spike","wall").contains(shape)) return;
        BlockPos at=ground(w,p); if(at==null) return;
        BlockState state=material(w.getBlockState(at));${terrainMaterial ? `
        if(surface!=null) {
            ResourceLocation id=ResourceLocation.tryParse(surface.contains(":")?surface:"${modId}:"+surface);
            if(id==null || !BuiltInRegistries.BLOCK.containsKey(id)) return;
            state=BuiltInRegistries.BLOCK.get(id).defaultBlockState();
        }` : ""}
${pointed ? `        if(shape.equals("spike") && taper>0) {
            if(!Double.isFinite(taper) || taper>1) return;
            int slices=Math.max(3,(int)Math.ceil(height*2));
            PARTS.removeIf(Entity::isRemoved);
            if(PARTS.stream().filter(e->e.level()==w).count()+slices>2048) return;
            Set<UUID> struck=new HashSet<>();
            for(int i=0;i<slices;i++) {
                double y=height*i/slices;
                double side=width*(1-taper*(double)i/slices);
                StudioTerrainPart piece=part(w,state,p.x-side/2,at.getY()+1+y,p.z-side/2,side,height/slices,grow,stay,lifts,damage,knockback,shatter,owner,0);
                if(piece!=null) piece.configure(y,side,height,struck)${interactions ? ".traits(traits)" : ""};
            }
            return;
        }
` : ""}        int across=(int)Math.ceil(width), rows=shape.equals("wall")?1:across;
        PARTS.removeIf(Entity::isRemoved);
        int needed=across*rows*(int)Math.ceil(height);
        if(PARTS.stream().filter(e->e.level()==w).count()+needed>2048) return;
        double angle=Math.toRadians(yaw), cs=Math.cos(angle), sn=Math.sin(angle);
        Set<UUID> struck=new HashSet<>();
        for(int x=0;x<across;x++) for(int z=0;z<rows;z++) {
            double sx=Math.min(1,width-x), sz=shape.equals("wall")?1:Math.min(1,width-z);
            double dx=-width/2+x, dz=shape.equals("wall")?-0.5:-width/2+z;
            double top=shape.equals("spike")?height*Math.max(0.15,1-Math.max(Math.abs((dx+sx/2)/(width/2)),Math.abs((dz+sz/2)/(width/2)))):height;
            for(int y=0;y<(int)Math.ceil(top);y++) {
                double h=Math.min(1,top-y);
                StudioTerrainPart made=part(w,state,p.x+dx*cs-dz*sn,at.getY()+1+y,p.z+dx*sn+dz*cs,sx,h,grow,stay,lifts,damage,knockback,shatter,owner,0);
                if(made!=null) made.configure(y,sz,height,struck)${interactions ? ".traits(traits)" : ""};
            }
        }
    }
    private static StudioTerrainPart part(ServerLevel w,BlockState state,double x,double y,double z,double width,double height,int grow,int stay,boolean lifts,float damage,double knockback,boolean shatter,Entity owner,double pop) {
        PARTS.removeIf(Entity::isRemoved);
        if(PARTS.stream().filter(e->e.level()==w).count()>=2048) return null;
        StudioTerrainPart e=new StudioTerrainPart(StudioFxTypes.TERRAIN${facade ? ".get()" : ""},w);
        e.begin(state,x,y,z,width,height,grow,stay,lifts,damage,knockback,shatter,owner,pop);
        if(!w.addFreshEntity(e)) return null;
        PARTS.add(e); return e;
    }
    public static void fragment(ServerLevel w,BlockState s,Vec3 p) { part(w,s,p.x-0.15,p.y,p.z-0.15,0.3,0.3,12,0,false,0,0,false,null,0.6); }
    private record Layer(BlockState state,long until${interactions ? ",UUID owner" : ""}) {}
    private static final class Entry {
        final BlockState original; final List<Layer> layers=new ArrayList<>();
        Entry(BlockState s) { original=s; }
        BlockState top() { return layers.isEmpty()?original:layers.get(layers.size()-1).state(); }
    }
    public static final class Ledger extends SavedData {
        final Map<Long,Entry> entries=new LinkedHashMap<>();
        public Ledger() {}
        public static Ledger load(CompoundTag tag${old ? "" : ", net.minecraft.core.HolderLookup.Provider registries"}) {
            Ledger data=new Ledger(); ListTag list=tag.getList("entries",10);
            for(int i=0;i<list.size();i++) {
                CompoundTag t=list.getCompound(i);
                Entry e=new Entry(NbtUtils.readBlockState(BuiltInRegistries.BLOCK.asLookup(),t.getCompound("original")));
                ListTag layers=t.getList("layers",10);
                for(int j=0;j<layers.size();j++) { CompoundTag l=layers.getCompound(j); e.layers.add(new Layer(NbtUtils.readBlockState(BuiltInRegistries.BLOCK.asLookup(),l.getCompound("state")),${interactions ? 'l.hasUUID("owner")?0:l.getLong("until"),l.hasUUID("owner")?l.getUUID("owner"):null' : 'l.getLong("until")'})); }
                data.entries.put(t.getLong("pos"),e);
            }
            return data;
        }
        @Override public CompoundTag save(CompoundTag tag${old ? "" : ", net.minecraft.core.HolderLookup.Provider registries"}) {
            ListTag list=new ListTag();
            for(var pair:entries.entrySet()) {
                CompoundTag t=new CompoundTag(); t.putLong("pos",pair.getKey()); t.put("original",NbtUtils.writeBlockState(pair.getValue().original));
                ListTag layers=new ListTag();
                for(Layer layer:pair.getValue().layers) { CompoundTag l=new CompoundTag(); l.put("state",NbtUtils.writeBlockState(layer.state())); l.putLong("until",layer.until());${interactions ? ' if(layer.owner()!=null) l.putUUID("owner",layer.owner());' : ""} layers.add(l); }
                t.put("layers",layers);list.add(t);
            }
            tag.put("entries",list); return tag;
        }
    }
    private static Ledger ledger(ServerLevel w) { return w.getDataStorage().computeIfAbsent(${old ? "Ledger::load, Ledger::new" : "new SavedData.Factory<>(Ledger::new, Ledger::load, null)"},LEDGER); }
    private static boolean safe(ServerLevel w,BlockPos p,BlockState s) { return !s.hasBlockEntity() && s.getDestroySpeed(w,p)>=0 && !s.is(Blocks.NETHER_PORTAL) && !s.is(Blocks.END_PORTAL) && !s.is(Blocks.MOVING_PISTON); }
    public static void swap(Level level,Vec3 center,String block,String shape,double radius,int height,int duration,String groups) {${interactions ? `
        swap(level,center,block,shape,radius,height,duration,groups,null);
    }
    public static void swap(Level level,Vec3 center,String block,String shape,double radius,int height,int duration,String groups,Entity owner) {` : ""}
        if(!(level instanceof ServerLevel w) || !Double.isFinite(radius)||radius<0.5||radius>8||height<1||height>8||duration<2||duration>2400||!Set.of("circle","square","sphere").contains(shape)||!w.getGameRules().getBoolean(GameRules.RULE_MOBGRIEFING)) return;
        if(!TARGETS.contains(block)) return;
        ResourceLocation id=ResourceLocation.tryParse(block);
        if(id==null || !BuiltInRegistries.BLOCK.containsKey(id)) return;
        BlockState next=BuiltInRegistries.BLOCK.get(id).defaultBlockState();
        BlockPos origin=BlockPos.containing(center).below();
        if(next.isAir() || !safe(w,origin,next)) return;
        Ledger data=ledger(w); int changed=0; int r=(int)Math.ceil(radius);
        for(int x=-r;x<=r && changed<512;x++) for(int z=-r;z<=r && changed<512;z++) for(int y=0;y<height && changed<512;y++) {
            if(!shape.equals("square") && (shape.equals("sphere")?x*x+z*z+Math.pow(y-(height-1)*0.5,2):x*x+z*z)>radius*radius) continue;
            BlockPos pos=origin.offset(x,y,z); if(!w.hasChunkAt(pos)) continue;
            BlockState old=w.getBlockState(pos);
            if(!safe(w,pos,old)) continue;
            String group=old.isAir()?"air":!old.getFluidState().isEmpty()?"liquid":old.canBeReplaced()?"soft":"solid";
            if(!Arrays.asList(groups.split(",")).contains(group)) continue;
            long key=pos.asLong(); Entry e=data.entries.get(key);
            if(e!=null && !old.equals(e.top())) { data.entries.remove(key); data.setDirty(); e=null; }
            if(e==null) { if(data.entries.size()>=4096) continue; e=new Entry(old); data.entries.put(key,e); }
            if(e.layers.size()>=16) continue;
            e.layers.add(new Layer(next,w.getGameTime()+Math.max(1,duration)${interactions ? ",owner==null?null:owner.getUUID()" : ""})); data.setDirty();
            w.setBlock(pos,next,18); changed++;
        }
    }
    ${interactions ? `public static void clear(Entity owner) {
        if(!(owner.level() instanceof ServerLevel w)) return;
        for(StudioTerrainPart e:List.copyOf(PARTS)) if(e.level()==w && e.expiresWith(owner)) e.discard();
        Ledger data=ledger(w);
        var it=data.entries.entrySet().iterator();
        while(it.hasNext()) {
            var pair=it.next(); Entry e=pair.getValue(); BlockPos pos=BlockPos.of(pair.getKey());
            BlockState expected=e.top();
            if(!e.layers.stream().anyMatch(l->owner.getUUID().equals(l.owner()))) continue;
            if(!w.hasChunkAt(pos)) {
                e.layers.replaceAll(l->owner.getUUID().equals(l.owner())?new Layer(l.state(),0,null):l);
            } else if(!w.getBlockState(pos).equals(expected)) { it.remove(); }
            else {
                e.layers.removeIf(l->owner.getUUID().equals(l.owner()));
                if(!e.top().equals(expected)) w.setBlock(pos,e.top(),18);
                if(e.layers.isEmpty()) it.remove();
            }
            data.setDirty();
        }
    }
    private static boolean departed(ServerLevel w,Layer layer) {
        if(layer.owner()==null) return false;
        Entity source=w.getEntity(layer.owner()); return source==null || !source.isAlive();
    }
    ` : ""}public static void tick(MinecraftServer server) {
        PARTS.removeIf(Entity::isRemoved);
        for(ServerLevel w:server.getAllLevels()) {
            Ledger data=ledger(w); int budget=128;
            Iterator<Map.Entry<Long,Entry>> it=data.entries.entrySet().iterator();
            while(it.hasNext()${interactions ? "" : " && budget>0"}) {
                var pair=it.next(); BlockPos pos=BlockPos.of(pair.getKey()); ${interactions ? `var chunk=w.getChunkSource().getChunkNow(pos.getX()>>4,pos.getZ()>>4); if(chunk==null) {
                    List<Layer> layers=pair.getValue().layers;
                    for(int i=0;i<layers.size();i++) if(departed(w,layers.get(i))) {
                        layers.set(i,new Layer(layers.get(i).state(),0,null)); data.setDirty();
                    }
                    continue;
                }` : "if(!w.hasChunkAt(pos)) continue;"}
                Entry e=pair.getValue(); BlockState expected=e.top();
                if(!${interactions ? "chunk" : "w"}.getBlockState(pos).equals(expected)) { it.remove();data.setDirty();continue; }
                if(!e.layers.removeIf(l->l.until()<=w.getGameTime()${interactions ? " || departed(w,l)" : ""})) continue;
                data.setDirty(); budget--;
                BlockState next=e.top(); w.setBlock(pos,next,18);
                if(e.layers.isEmpty()) it.remove();
            }
        }
    }
}
`
}

export function terrainPartSource(pkg: string, ownDust = false, interactions = false, muted = false) {
  const originalDust = "new BlockParticleOption(ParticleTypes.BLOCK,material)"
  const dust = ownDust ? `owner == null ? ${originalDust} : StudioBuiltin.particle(owner, "terrain_shatter", ${originalDust})` : originalDust
  return `package ${pkg}.entity;
import java.util.*;
import net.minecraft.core.particles.*;
import net.minecraft.nbt.*;
import net.minecraft.network.syncher.*;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.*;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.*;
import org.joml.Vector3f;

/** A synced vanilla block display with a growing collision box, never a world block. */
public class StudioTerrainPart extends Display.BlockDisplay {
    private static final EntityDataAccessor<Vector3f> BOUNDS=SynchedEntityData.defineId(StudioTerrainPart.class,EntityDataSerializers.VECTOR3);
    private static final EntityDataAccessor<Boolean> SOLID=SynchedEntityData.defineId(StudioTerrainPart.class,EntityDataSerializers.BOOLEAN);
    private double baseX,baseY,baseZ,width,height,depth=1,layer,totalHeight,pop,knockback;
    private int grow,stay,age;
    private boolean shatter, lifts;
    private float damage;
    ${interactions ? `private StudioTerrain.Traits traits;
    boolean expiresWith(Entity source) { return traits!=null && traits.restore() && owner==source; }
    boolean ownedBy(Entity entity) { return owner==entity; }
    Set<UUID> group() { return struck; }
    boolean canBreak(double power) { return canBeCollidedWith() && traits!=null && traits.hardness()>=0 && power>=traits.hardness(); }
    void crumble() {
        ServerLevel w=(ServerLevel)level();
        w.sendParticles(${dust},getX()+width/2,getY()+height/2,getZ()+depth/2,6,width/2,height/2,depth/2,0.1);
        for(int i=0;i<2;i++) StudioTerrain.fragment(w,material,position().add(width/2,height/2,depth/2));
        discard();
    }
    void traits(StudioTerrain.Traits value) { traits=value; }
    boolean blocks(int kind) { return traits!=null && (traits.stops()&kind)!=0 && canBeCollidedWith(); }
    @Override public boolean isPickable() { return blocks(4); }
    @Override public boolean hurt(net.minecraft.world.damagesource.DamageSource source,float damage) {
        if(blocks(4) && source.getDirectEntity() instanceof net.minecraft.world.entity.projectile.Projectile projectile) { projectile.discard();return true; }
        return false;
    }
    ` : ""}private Entity owner;
    private BlockState material;
    private Set<UUID> struck=new HashSet<>();
    public StudioTerrainPart(EntityType<? extends StudioTerrainPart> type,Level world) { super(type,world); setNoGravity(true); }
    @Override protected void defineSynchedData(SynchedEntityData.Builder builder) { super.defineSynchedData(builder); builder.define(BOUNDS,new Vector3f());builder.define(SOLID,false); }
    public StudioTerrainPart configure(double layer,double depth,double total,Set<UUID> struck) { this.layer=layer;this.depth=depth;this.totalHeight=total;this.struck=struck;return this; }
    public void begin(BlockState state,double x,double y,double z,double width,double height,int grow,int stay,boolean lifts,float damage,double knockback,boolean shatter,Entity owner,double pop) {
        material=state;baseX=x;baseY=y;baseZ=z;this.width=width;this.height=height;this.totalHeight=height;this.depth=width;
        this.grow=Math.max(1,grow);this.stay=stay;this.damage=damage;this.knockback=knockback;this.shatter=shatter;this.lifts=lifts;this.owner=owner;this.pop=pop;
        getEntityData().set(SOLID,pop==0); setPos(x,y,z); appearance(0.001);
    }
    private static ListTag floats(float... values) { ListTag list=new ListTag(); for(float f:values)list.add(FloatTag.valueOf(f));return list; }
    private void appearance(double h) {
        CompoundTag data=new CompoundTag();data.put("block_state",NbtUtils.writeBlockState(material));
        CompoundTag transform=new CompoundTag();transform.put("translation",floats(0,0,0));transform.put("left_rotation",floats(0,0,0,1));transform.put("right_rotation",floats(0,0,0,1));transform.put("scale",floats((float)width,(float)h,(float)depth));
        if(h<=0.001) transform.put("scale",floats(0,0,0));
        data.put("transformation",transform);data.putInt("teleport_duration",1);data.putInt("interpolation_duration",1);data.putInt("start_interpolation",0);
        super.readAdditionalSaveData(data);getEntityData().set(BOUNDS,new Vector3f((float)width,(float)h,(float)depth));
        setBoundingBox(new AABB(getX(),getY(),getZ(),getX()+width,getY()+h,getZ()+depth));
    }
    @Override public void tick() {
        super.tick();
        if(level().isClientSide()) { Vector3f b=getEntityData().get(BOUNDS);setBoundingBox(new AABB(getX(),getY(),getZ(),getX()+b.x(),getY()+b.y(),getZ()+b.z()));return; }
        ${interactions ? "if(traits!=null && traits.restore() && owner!=null && (!owner.isAlive() || owner.level()!=level())) { discard(); return; }\n        " : ""}if(material==null || ++age>grow+stay) {
            if(material!=null && shatter) {
                ServerLevel w=(ServerLevel)level();
                ${muted ? 'if (owner == null || StudioBuiltin.visible(owner, "terrain_shatter")) ' : ""}w.sendParticles(${dust},getX()+width/2,getY()+height/2,getZ()+depth/2,6,width/2,height/2,depth/2,0.1);
                for(int i=0;i<2;i++) StudioTerrain.fragment(w,material,position().add(width/2,height/2,depth/2));
            }
            discard();return;
        }
        if(pop>0) {
            double done=(double)age/grow;double drift=width<1?age*0.035:0;setPos(baseX+drift*((getId()&1)==0?1:-1),baseY+4*pop*done*(1-done),baseZ+drift*((getId()&2)==0?1:-1));appearance(height);return;
        }
        double h=Math.max(0.001,Math.min(height,totalHeight*Math.min(1,(double)age/grow)-layer));
        double previous=getBoundingBox().maxY;appearance(h);
        if(h<=0.001) return;
        AABB box=getBoundingBox();
        for(LivingEntity entity:level().getEntitiesOfClass(LivingEntity.class,box.inflate(0.02,0.1,0.02))) {
            if(lifts && getEntityData().get(SOLID) && entity.getY()>=previous-0.15 && entity.getY()<box.maxY+0.05) {
                double delta=box.maxY-entity.getY();
                if(delta>0 && level().noCollision(entity,entity.getBoundingBox().move(0,delta+0.001,0))) { entity.setPos(entity.getX(),box.maxY+0.001,entity.getZ());entity.setOnGround(true);entity.fallDistance=0;entity.hurtMarked=true; }
            }
            if(entity==owner || owner!=null && (owner.isAlliedTo(entity) || owner.getType()==entity.getType()) || !struck.add(entity.getUUID())) continue;
            if(damage>0) entity.hurt(owner instanceof LivingEntity living?damageSources().mobAttack(living):damageSources().magic(),damage);
            if(knockback>0) { Vec3 away=entity.position().subtract(position()).multiply(1,0,1).normalize().scale(knockback);entity.push(away.x,0.15,away.z);entity.hurtMarked=true; }
        }
    }
    @Override public boolean canBeCollidedWith() { return getEntityData().get(SOLID) && !isRemoved() && getEntityData().get(BOUNDS).y()>0.01f; }
    @Override public boolean canCollideWith(Entity other) { return canBeCollidedWith(); }
    @Override public boolean isPushable() { return false; }
    @Override public boolean shouldBeSaved() { return false; }
}
`
}
import { stripJava } from "../gameplay-scan"
export const gameplayUsesTerrainOptions = (docs: readonly {sources: readonly {content: string}[]}[]) =>
  docs.some(doc => doc.sources.some(s => /\bProjectContent\s*\.\s*(?:terrainRiseWith|blockSwapWithOwner)\s*\(|\bimport\s+static\s+[\w.]+\.ProjectContent\.(?:terrainRiseWith|blockSwapWithOwner)\s*;/.test(stripJava(s.content).code)))
export const gameplayUsesTerrain = (docs: readonly { sources: readonly { content: string }[] }[]) =>
  docs.some((d) =>
    d.sources.some((s) =>
      /\bProjectContent\s*\.\s*(?:terrainRise|blockSwap|popBlocks)\s*\(|\bimport\s+static\s+[\w.]+\.ProjectContent\.(?:terrainRise|blockSwap|popBlocks)\s*;/.test(
        stripJava(s.content).code,
      ),
    ),
  )
export function terrainAccessor(pkg: string, options = false) {
  return `
    /** Temporary terrain from any item, trap, arena or creature; server side, with bounded budgets. */
    public static void terrainRise(net.minecraft.world.level.Level world, net.minecraft.world.phys.Vec3 at, float yaw, String shape, double width, double height, int riseTicks, int stayTicks, boolean lifts, float damage, double knockback, boolean shatter, Entity owner) {
        ${pkg}.entity.StudioTerrain.rise(world,at,yaw,shape,width,height,riseTicks,stayTicks,lifts,damage,knockback,shatter,owner);
    }
    public static void blockSwap(net.minecraft.world.level.Level world, net.minecraft.world.phys.Vec3 at, String block, String shape, double radius, int height, int restoreTicks, String onlyReplace) {
        ${pkg}.entity.StudioTerrain.swap(world,at,block,shape,radius,height,restoreTicks,onlyReplace);
    }
    ${options ? `public static void terrainRiseWith(net.minecraft.world.level.Level world, net.minecraft.world.phys.Vec3 at, float yaw, String shape, double width, double height, int riseTicks, int stayTicks, boolean lifts, float damage, double knockback, boolean shatter, Entity owner, double taper, String material, boolean beam, boolean area, boolean projectile, double hardness, boolean restore) {
        if(!Double.isFinite(hardness)||hardness < -1||hardness > 50||!Double.isFinite(taper)||taper<0||taper>1) return;
        var traits=new ${pkg}.entity.StudioTerrain.Traits((beam?1:0)|(area?2:0)|(projectile?4:0),hardness,restore);
        ${pkg}.entity.StudioTerrain.rise(world,at,yaw,shape,width,height,riseTicks,stayTicks,lifts,damage,knockback,shatter,owner,taper,material,traits);
    }
    public static void blockSwapWithOwner(net.minecraft.world.level.Level world, net.minecraft.world.phys.Vec3 at, String block, String shape, double radius, int height, int restoreTicks, String onlyReplace, Entity owner) {
        ${pkg}.entity.StudioTerrain.swap(world,at,block,shape,radius,height,restoreTicks,onlyReplace,owner);
    }
    ` : ""}public static void popBlocks(net.minecraft.world.level.Level world, net.minecraft.world.phys.Vec3 at, double from, double to, int ticks, double height, int every, int max) {
        if(!Double.isFinite(from)||!Double.isFinite(to)||!Double.isFinite(height)||from<0||from>8||to<=from||to>32||ticks<4||ticks>80||height<0.1||height>4||every<1||every>20||max<1||max>128) return;
        var spec=new ${pkg}.entity.StudioFxSpec(2,ticks,0,ticks,(float)from,(float)to,0.8f,0f,0xc1cbd1,false,0f,0,0,false,0,new int[]{},null,null,0,0f,0f,0f,false,0f);
        ${pkg}.entity.StudioFx.start(world,${pkg}.entity.StudioTerrain.popSpec(spec,height,every,max),at,0,null,null,1,null);
    }
`
}
