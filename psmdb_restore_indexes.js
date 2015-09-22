#!/usr/bin/mongo --quiet

// restore indexes from tokumx_dump_indexes.js
//
// author: david. bennett at percona. com
//
// usage example:
//   mongo -u admin -p {pwd} psmdb_restore_indexes.js \
//     --eval " data='./tokumxIndexes.json' "

// === configuration self-explanatory  ===

// these can be specified on command line in eval
// with optXxx prefix.  For example:
//
// ./psmdb_restore_indexes.js --eval " optDEBUG=3; optTrialRun=true; "

// debug level - higher is more verbose
// (default: 0)
var DEBUG =
  typeof optDEBUG === 'undefined'
  ? 0
  : optDEBUG;

// should we skip existing indexes?
// (default: true)
var skipExistingIndexes =
  typeof optSkipExistingIndexes === 'undefined'
  ? true
  : optSkipExistingIndexes;

// should we skip collections not defined in db?
// (default: true)
var skipMissingCollections = 
  typeof optSkipMissingCollections === 'undefined'
  ? true
  : optSkipMissingCollections;

// perform trial run without creating indexes?
// (default: false)
var trialRun =
  typeof optTrialRun === 'undefined'
  ? false
  : optTrialRun;

// options to remove from TokuMX index defintions
var cleanseProperties=['clustering','ns','key'];

// === functions ===

// this function will search an index by name
function search(nameKey, myArray){
  for (var i=0; i < myArray.length; i++) {
    if (myArray[i].name === nameKey) {
      return myArray[i];
    }
  }
  return null;
}

// clone an object
function clone(obj) {
  if (null == obj || "object" != typeof obj) return obj;
  var copy = obj.constructor();
  for (var attr in obj) {
    if (obj.hasOwnProperty(attr)) copy[attr] = obj[attr];
  }
  return copy;
}

// === main script ===

// load data exported by tokumx_dump_indexes.js
if (typeof data  === 'undefined') {
  data="tokumxIndexes.json";
}

load(data);

// validate data

if (typeof tokumxIndexes === 'undefined') {
  print("Invalid index dump.");
  quit(1);
}

if (tokumxIndexes.length <= 0) {
  print("No indexes found.");
  quit(1);
}

// iterate through databases found in dump
dbNames = Object.getOwnPropertyNames(tokumxIndexes);

for (d in dbNames) {

  dbName = dbNames[d];

  db = db.getSiblingDB(dbName);

  dbObject = tokumxIndexes[dbName];

  collectionNames = Object.getOwnPropertyNames(dbObject);

  existingCollections = db.getCollectionNames();

  if (DEBUG>0) { print(dbName); }

  // iterate through collections found in dump 
  for (c in collectionNames) {

    collectionName = collectionNames[c];

    collection = db[collectionName];

    indexArray = dbObject[collectionName];

    existingIndexes = collection.getIndexes();

    if (DEBUG > 0) { print("\t"+collectionName); }

    // if specified, skip collections not found in db
    if (skipMissingCollections) {
      if (existingCollections.indexOf(collectionName) < 0) {
        if (DEBUG > 0) { print("\t\tSKIP: missing collection"); }
        continue;
      }
    }

    // interate through arrays
    for (i in indexArray) {

      index = indexArray[i];

      indexName = index.name;

      if (DEBUG > 0) { print("\t\t"+indexName); }

      if (skipExistingIndexes) {
        if (search(index.name, existingIndexes) != null) {
          if (DEBUG > 0) { print("\t\t\tSKIP: existing index"); }
          continue;
        }
      }

      // make a copy of index to use for options
      options=clone(index);

      if (typeof index.key === 'undefined') {
        if (DEBUG > 0) { print("\t\t\tSKIP: count not find keys"); }
        continue;
      }

      // cleanse options 
      for (cp in cleanseProperties) {
        cpName=cleanseProperties[cp];
        if (typeof options[cpName] !== 'undefined') {
          if (DEBUG > 1) { print("\t\t\tRemoving from options ("+cpName+":"+options[cpName]+")"); }
          delete options[cpName];
        }
      }

      if (DEBUG > 2) {
        print("\t\t\tkeys:");
        printjson(index.key);
        print("\t\t\toptions:")
        printjson(options);
      }

      // create the index
      if (!trialRun) {
        if (DEBUG > 0) { print("\t\t\tCreating index: "+indexName); }
        collection.createIndex(index.key, options);
      } else {
        if (DEBUG > 0) { print("\t\t\tWould create index: "+indexName); }
      }
    }
  }
}

