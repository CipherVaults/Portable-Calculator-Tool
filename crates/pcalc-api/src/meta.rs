//! `meta.versions`: `{api, app, engines:{…}}`.

use serde::Serialize;
use serde_json::Value;

use crate::envelope::{ok_json, ApiError};
use crate::{API_VERSION, APP_VERSION};

#[derive(Serialize)]
struct Engines {
    #[serde(rename = "date-core")]
    date_core: &'static str,
    #[serde(rename = "percent-core")]
    percent_core: &'static str,
    #[serde(rename = "calc-num")]
    calc_num: &'static str,
    #[serde(rename = "calc-core")]
    calc_core: &'static str,
    #[serde(rename = "units-core")]
    units_core: &'static str,
    #[serde(rename = "graph-core")]
    graph_core: &'static str,
}

#[derive(Serialize)]
struct Versions {
    api: u32,
    app: &'static str,
    engines: Engines,
}

/// The request must be the empty object `{}`.
pub(crate) fn versions(req: &str) -> String {
    match serde_json::from_str::<Value>(req) {
        Ok(Value::Object(map)) if map.is_empty() => ok_json(Versions {
            api: API_VERSION,
            app: APP_VERSION,
            engines: Engines {
                date_core: date_core::ENGINE_VERSION,
                percent_core: percent_core::ENGINE_VERSION,
                calc_num: calc_num::ENGINE_VERSION,
                calc_core: calc_core::ENGINE_VERSION,
                units_core: units_core::ENGINE_VERSION,
                graph_core: graph_core::ENGINE_VERSION,
            },
        }),
        _ => ApiError::INVALID_REQUEST.to_json(),
    }
}
