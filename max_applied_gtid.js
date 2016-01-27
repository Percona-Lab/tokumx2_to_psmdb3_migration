#!/usr/bin/mongo --quiet

var gtidHexString='';

db=db.getSiblingDB('local');

db.oplog.rs.find().sort({$natural:-1}).limit(1).forEach(function(o){
  gtidHexString = o._id.hex();
});

if (gtidHexString == '') {
  print("GTID not found.");
  quit();
}

var uuid=gtidHexString.substring(16);
var seq=gtidHexString.substring(0,16);

if (typeof uuid !== 'string' ||
    uuid.length != 16 ||
    typeof seq !== 'string' ||
    seq.length != 16) {
  print("Unknown GTID format.");
  quit();
}

var gtid=parseInt(seq,16)+':'+parseInt(uuid,16);

print("To catchup from this image, use the toku2mongo parameter: --gtid="+gtid);
