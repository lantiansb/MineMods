package legacymod.client;
import legacymod.ModEntities; import net.minecraftforge.fml.client.registry.RenderingRegistry;
public class ClientProxy { public void init() { RenderingRegistry.registerEntityRenderingHandler(ModEntities.SNOW_OWL, SnowOwlRenderer::new); } }
