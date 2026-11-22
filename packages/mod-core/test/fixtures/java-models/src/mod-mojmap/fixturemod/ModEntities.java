package fixturemod;
import java.util.function.Supplier;
import net.minecraft.world.entity.EntityType; import net.neoforged.neoforge.registries.DeferredRegister;
public class ModEntities {
  public static final DeferredRegister<EntityType<?>> ENTITIES = DeferredRegister.create("entity_type", "fixturemod");
  public static final Supplier<EntityType<Object>> CRYSTAL_DEER = ENTITIES.register("crystal_deer", () -> EntityType.make("crystal_deer"));
  public static final Supplier<EntityType<Object>> PACK_WOLF = ENTITIES.register("pack_wolf", () -> EntityType.make("pack_wolf"));
  public static final Supplier<EntityType<Object>> SWAMP_WALKER = ENTITIES.register("swamp_walker", () -> EntityType.make("swamp_walker"));
}
