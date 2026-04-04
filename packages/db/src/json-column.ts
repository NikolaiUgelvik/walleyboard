import { customType } from "drizzle-orm/sqlite-core";

type JsonTextColumnData<T> = {
  data: T;
  driverData: string;
};

const jsonTextColumn = <T>() =>
  customType<JsonTextColumnData<T>>({
    dataType() {
      return "text";
    },
    toDriver(value) {
      return JSON.stringify(value);
    },
    fromDriver(value) {
      return JSON.parse(value) as T;
    },
  });

export function jsonText<T>(name: string) {
  return jsonTextColumn<T>()(name);
}
