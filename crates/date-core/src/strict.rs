//! A pass-through serde `Deserializer` adapter that makes struct
//! deserialization strict about shape.
//!
//! Derived `Deserialize` impls accept a struct either as a map (JSON object)
//! or, positionally, as a sequence (JSON array): `"req": ["2024-01-01"]`
//! would silently become `{"startDate":"2024-01-01"}`, and `"req": []` a
//! request of defaults. `deny_unknown_fields` does not cover that path. The
//! IPC surface must accept objects only, so [`Strict`] wraps a deserializer
//! and, recursively through every nested value, turns each
//! `deserialize_struct` request into `deserialize_map`, which fails on
//! anything but an object.
//!
//! Enums get the same treatment: serde's externally tagged form accepts a
//! unit variant either as a string (`"add"`) or as a single-key map
//! (`{"add": null}`). Every request enum is unit-only and documented as a
//! string, so `deserialize_enum` accepts strings only. Every other call is
//! forwarded unchanged.

use std::fmt;

use serde::de::value::{BorrowedStrDeserializer, StrDeserializer, StringDeserializer};
use serde::de::{
    self, DeserializeSeed, Deserializer, EnumAccess, MapAccess, SeqAccess, VariantAccess, Visitor,
};

/// The strict deserializer adapter.
pub(crate) struct Strict<D>(pub D);

/// Wraps a visitor so that nested deserializers are wrapped too.
struct StrictVisitor<V>(V);

/// Wraps a seed so that the value it deserializes is wrapped.
struct StrictSeed<S>(S);

/// Wraps map access (keys and values).
struct StrictMap<A>(A);

/// Wraps sequence access (elements).
struct StrictSeq<A>(A);

/// Wraps enum access (variant payloads).
struct StrictEnum<A>(A);

macro_rules! forward_deserialize {
    ($($method:ident),* $(,)?) => {$(
        fn $method<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, D::Error> {
            self.0.$method(StrictVisitor(visitor))
        }
    )*};
}

impl<'de, D: Deserializer<'de>> Deserializer<'de> for Strict<D> {
    type Error = D::Error;

    forward_deserialize!(
        deserialize_any,
        deserialize_bool,
        deserialize_i8,
        deserialize_i16,
        deserialize_i32,
        deserialize_i64,
        deserialize_i128,
        deserialize_u8,
        deserialize_u16,
        deserialize_u32,
        deserialize_u64,
        deserialize_u128,
        deserialize_f32,
        deserialize_f64,
        deserialize_char,
        deserialize_str,
        deserialize_string,
        deserialize_bytes,
        deserialize_byte_buf,
        deserialize_option,
        deserialize_unit,
        deserialize_seq,
        deserialize_map,
        deserialize_identifier,
        deserialize_ignored_any,
    );

    fn deserialize_unit_struct<V: Visitor<'de>>(
        self,
        name: &'static str,
        visitor: V,
    ) -> Result<V::Value, D::Error> {
        self.0.deserialize_unit_struct(name, StrictVisitor(visitor))
    }

    fn deserialize_newtype_struct<V: Visitor<'de>>(
        self,
        name: &'static str,
        visitor: V,
    ) -> Result<V::Value, D::Error> {
        self.0
            .deserialize_newtype_struct(name, StrictVisitor(visitor))
    }

    fn deserialize_tuple<V: Visitor<'de>>(
        self,
        len: usize,
        visitor: V,
    ) -> Result<V::Value, D::Error> {
        self.0.deserialize_tuple(len, StrictVisitor(visitor))
    }

    fn deserialize_tuple_struct<V: Visitor<'de>>(
        self,
        name: &'static str,
        len: usize,
        visitor: V,
    ) -> Result<V::Value, D::Error> {
        self.0
            .deserialize_tuple_struct(name, len, StrictVisitor(visitor))
    }

    /// The point of the adapter: a struct must be a map.
    fn deserialize_struct<V: Visitor<'de>>(
        self,
        _name: &'static str,
        _fields: &'static [&'static str],
        visitor: V,
    ) -> Result<V::Value, D::Error> {
        self.0.deserialize_map(StrictVisitor(visitor))
    }

    /// An enum must be a plain string naming a unit variant.
    ///
    /// serde's externally tagged form also accepts a single-key map
    /// (`{"add": null}`), which the IPC contract (and the JS mirror) does not
    /// allow. Every request enum is unit-only, so the value is read as a
    /// string and handed to the visitor as the variant name; a payload-carrying
    /// variant then fails in `VariantAccess`, as it should.
    fn deserialize_enum<V: Visitor<'de>>(
        self,
        _name: &'static str,
        _variants: &'static [&'static str],
        visitor: V,
    ) -> Result<V::Value, D::Error> {
        self.0.deserialize_str(UnitEnumVisitor(visitor))
    }

    fn is_human_readable(&self) -> bool {
        self.0.is_human_readable()
    }
}

macro_rules! forward_visit {
    ($($method:ident($ty:ty)),* $(,)?) => {$(
        fn $method<E: de::Error>(self, v: $ty) -> Result<Self::Value, E> {
            self.0.$method(v)
        }
    )*};
}

impl<'de, V: Visitor<'de>> Visitor<'de> for StrictVisitor<V> {
    type Value = V::Value;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.expecting(f)
    }

    forward_visit!(
        visit_bool(bool),
        visit_i8(i8),
        visit_i16(i16),
        visit_i32(i32),
        visit_i64(i64),
        visit_i128(i128),
        visit_u8(u8),
        visit_u16(u16),
        visit_u32(u32),
        visit_u64(u64),
        visit_u128(u128),
        visit_f32(f32),
        visit_f64(f64),
        visit_char(char),
        visit_str(&str),
        visit_borrowed_str(&'de str),
        visit_string(String),
        visit_bytes(&[u8]),
        visit_borrowed_bytes(&'de [u8]),
        visit_byte_buf(Vec<u8>),
    );

    fn visit_none<E: de::Error>(self) -> Result<Self::Value, E> {
        self.0.visit_none()
    }

    fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
        self.0.visit_unit()
    }

    fn visit_some<D2: Deserializer<'de>>(self, d: D2) -> Result<Self::Value, D2::Error> {
        self.0.visit_some(Strict(d))
    }

    fn visit_newtype_struct<D2: Deserializer<'de>>(self, d: D2) -> Result<Self::Value, D2::Error> {
        self.0.visit_newtype_struct(Strict(d))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, seq: A) -> Result<Self::Value, A::Error> {
        self.0.visit_seq(StrictSeq(seq))
    }

    fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<Self::Value, A::Error> {
        self.0.visit_map(StrictMap(map))
    }

    fn visit_enum<A: EnumAccess<'de>>(self, data: A) -> Result<Self::Value, A::Error> {
        self.0.visit_enum(StrictEnum(data))
    }
}

/// Accepts only a string and feeds it to the wrapped enum visitor as a
/// unit-variant name. Every non-string input falls through to the default
/// `Visitor` methods, which reject it with an "invalid type" error.
struct UnitEnumVisitor<V>(V);

impl<'de, V: Visitor<'de>> Visitor<'de> for UnitEnumVisitor<V> {
    type Value = V::Value;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.expecting(f)
    }

    fn visit_str<E: de::Error>(self, v: &str) -> Result<Self::Value, E> {
        self.0.visit_enum(StrDeserializer::<E>::new(v))
    }

    fn visit_borrowed_str<E: de::Error>(self, v: &'de str) -> Result<Self::Value, E> {
        self.0.visit_enum(BorrowedStrDeserializer::<E>::new(v))
    }

    fn visit_string<E: de::Error>(self, v: String) -> Result<Self::Value, E> {
        self.0.visit_enum(StringDeserializer::<E>::new(v))
    }
}

impl<'de, S: DeserializeSeed<'de>> DeserializeSeed<'de> for StrictSeed<S> {
    type Value = S::Value;

    fn deserialize<D2: Deserializer<'de>>(self, d: D2) -> Result<S::Value, D2::Error> {
        self.0.deserialize(Strict(d))
    }
}

impl<'de, A: MapAccess<'de>> MapAccess<'de> for StrictMap<A> {
    type Error = A::Error;

    fn next_key_seed<K: DeserializeSeed<'de>>(
        &mut self,
        seed: K,
    ) -> Result<Option<K::Value>, A::Error> {
        self.0.next_key_seed(StrictSeed(seed))
    }

    fn next_value_seed<V: DeserializeSeed<'de>>(&mut self, seed: V) -> Result<V::Value, A::Error> {
        self.0.next_value_seed(StrictSeed(seed))
    }

    fn size_hint(&self) -> Option<usize> {
        self.0.size_hint()
    }
}

impl<'de, A: SeqAccess<'de>> SeqAccess<'de> for StrictSeq<A> {
    type Error = A::Error;

    fn next_element_seed<T: DeserializeSeed<'de>>(
        &mut self,
        seed: T,
    ) -> Result<Option<T::Value>, A::Error> {
        self.0.next_element_seed(StrictSeed(seed))
    }

    fn size_hint(&self) -> Option<usize> {
        self.0.size_hint()
    }
}

impl<'de, A: EnumAccess<'de>> EnumAccess<'de> for StrictEnum<A> {
    type Error = A::Error;
    type Variant = StrictEnum<A::Variant>;

    fn variant_seed<V: DeserializeSeed<'de>>(
        self,
        seed: V,
    ) -> Result<(V::Value, Self::Variant), A::Error> {
        self.0
            .variant_seed(StrictSeed(seed))
            .map(|(value, variant)| (value, StrictEnum(variant)))
    }
}

impl<'de, A: VariantAccess<'de>> VariantAccess<'de> for StrictEnum<A> {
    type Error = A::Error;

    fn unit_variant(self) -> Result<(), A::Error> {
        self.0.unit_variant()
    }

    fn newtype_variant_seed<T: DeserializeSeed<'de>>(self, seed: T) -> Result<T::Value, A::Error> {
        self.0.newtype_variant_seed(StrictSeed(seed))
    }

    fn tuple_variant<V: Visitor<'de>>(self, len: usize, visitor: V) -> Result<V::Value, A::Error> {
        self.0.tuple_variant(len, StrictVisitor(visitor))
    }

    fn struct_variant<V: Visitor<'de>>(
        self,
        fields: &'static [&'static str],
        visitor: V,
    ) -> Result<V::Value, A::Error> {
        self.0.struct_variant(fields, StrictVisitor(visitor))
    }
}
