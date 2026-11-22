package {{package_name}};

import com.mojang.logging.LogUtils;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import org.slf4j.Logger;

@Mod({{ClassName}}.MOD_ID)
public final class {{ClassName}} {
    public static final String MOD_ID = "{{mod_id}}";
    public static final Logger LOGGER = LogUtils.getLogger();

    public {{ClassName}}(IEventBus modEventBus, ModContainer modContainer) {
        LOGGER.info("[{}] initializing", MOD_ID);
    }
}
