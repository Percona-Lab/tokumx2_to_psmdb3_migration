#!/usr/bin/mongo --quiet

// dump indexes to a json file

// author: david. bennett at percona. com

// usage example: 
//   mongo -u admin -p {pwd} tokumx_dump_indexes.js > tokumxIndexes.json 

var result={};

db = db.getSiblingDB('admin');

var dbs = db.adminCommand('listDatabases');

dbs.databases.forEach(function(database){

  if (database.name === 'local') {
    return;
  }

  result[database.name]={};

  db = db.getSiblingDB(database.name);

  db.getCollectionNames().forEach(function(collection) {
    result[database.name][collection]=db[collection].getIndexes();
  });

});

print("var tokumxIndexes=");
printjson(result);
