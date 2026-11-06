plugins {
  alias(libs.plugins.android.application)
}

android {
    namespace = "com.jackai.dshmobile"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.jackai.dshmobile"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        // The page is served by the DSH host and never bundled — that is what
        // keeps UI edits hot-reloadable. This default only seeds a fresh
        // install; override with -PdshUrl=https://host/mp/ when building.
        buildConfigField(
            "String",
            "DEFAULT_URL",
            "\"${project.findProperty("dshUrl") ?: "https://dev.mac.followjack.cn/mp/"}\"",
        )
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
      compose = false
      aidl = false
      buildConfig = true
      shaders = false
    }

    packaging {
      resources {
        excludes += "/META-INF/{AL2.0,LGPL2.1}"
      }
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
  // A WebView shell needs almost nothing: a lifecycle-aware ComponentActivity
  // plus the activity-result contracts that hand picker and permission results
  // back to the WebView.
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.lifecycle.runtime.ktx)
  implementation(libs.androidx.activity.compose)
}
