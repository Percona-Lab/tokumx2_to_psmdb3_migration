#!/usr/bin/mongo --quiet

db = db.getSiblingDB('admin');

var dbs = db.adminCommand('listDatabases');

dbs.databases.forEach(function(database){
  print("Database: " + database.name);
  print("-----");

  db = db.getSiblingDB(database.name);

  db.getCollectionNames().forEach(function(collection) {
    indexes = db[collection].getIndexes();
    print("Collection '" + collection + "' documents: " + db[collection].count());
    print("Indexes for " + collection + ":");
    printjson(indexes);
  });

  print("");

});
