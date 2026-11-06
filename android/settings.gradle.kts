pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("androidx.*")
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google {
            content {
                includeGroupByRegex("androidx.*")
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
            }
        }
        mavenCentral()
    }
}

rootProject.name = "DSH Mobile"
include(":app")

// 本机代理配置（proxy.properties，已被 .gitignore 忽略）在这里读入，
// 这样仓库里不留任何某台机器的网络设置。
val localProxy = File(settingsDir, "proxy.properties")
if (localProxy.exists()) {
    java.util.Properties().apply { localProxy.inputStream().use { load(it) } }
        .forEach { (k, v) -> System.setProperty(k.toString(), v.toString()) }
}
